import { NextRequest, NextResponse } from "next/server"
import { Duration, Ratelimit } from "@upstash/ratelimit"

import { Redis } from "@upstash/redis"
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'

const rateLimitMap = new Map<string, number[]>()

let redis: Redis
let sessionRatelimit: Ratelimit
let ipRatelimit: Ratelimit
let currentConfig: any = {}

function initialize({ sessionLimit, sessionWindow, ipLimit, ipWindow, upstash }: Partial<RateLimitOptions>) {
    const { url, token, analytics } = upstash!

    const config = {
        sessionLimit,
        sessionWindow,
        ipLimit,
        ipWindow,
        upstash
    }

    if (!redis || JSON.stringify(config) !== JSON.stringify(currentConfig)) {
        currentConfig = config

        redis = new Redis({
            url: url,
            token: token,
        })

        sessionRatelimit = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(sessionLimit!, `${sessionWindow} s` as Duration),
            analytics
        })

        ipRatelimit = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(ipLimit!, `${ipWindow} s` as Duration),
            analytics
        })
    }
}

interface RateLimitOptions {
    request: NextRequest
    response: NextResponse
    sessionLimit?: number
    ipLimit?: number
    sessionWindow?: number
    ipWindow?: number
    upstash?: {
        enabled?: boolean
        url?: string
        token?: string
        analytics?: boolean
    }
    windowMs?: number
}

/**
 * This middleware is used to rate limit requests based
 * on IP address and session ID. Returns NextResponse with 
 * 429 status code if the rate limit is exceeded.
 * @param {RateLimitOptions} options - Rate limiting options.
 * @param {NextRequest} options.request - NextRequest object.
 * @param {NextResponse} options.response - NextResponse object.
 * @param {number} [options.sessionLimit=20] - Number of requests allowed per session in the window.
 * @param {number} [options.ipLimit=100] - Number of requests allowed per IP in the window.
 * @param {number} [options.sessionWindow=10] - Window in seconds for session rate limiting.
 * @param {number} [options.ipWindow=10] - Window in seconds for IP rate limiting.
 * @param {object} [options.upstash] - Upstash Redis configuration.
 * @param {boolean} [options.upstash.enabled] - Enable Upstash Redis rate limiting.
 * @param {string} [options.upstash.url] - Upstash Redis REST URL.
 * @param {string} [options.upstash.token] - Upstash Redis REST token.
 * @param {boolean} [options.upstash.analytics] - Enable analytics for rate limiting.
 */
export async function rateLimit({
    request,
    response,
    sessionLimit = 20,
    ipLimit = 100,
    sessionWindow = 10,
    ipWindow = 10,
    upstash = {},
    windowMs,
}: RateLimitOptions) {
    const errorResponse = NextResponse.json({ message: "Too Many Requests" }, { status: 429 })

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1'
    let sessionId = (await cookies()).get('session_id')?.value

    if (!sessionId) {
        sessionId = uuidv4()
        response.cookies.set("session_id", sessionId)
    }

    upstash.url = upstash.url || process.env.UPSTASH_REDIS_REST_URL
    upstash.token = upstash.token || process.env.UPSTASH_REDIS_REST_TOKEN

    // Merge defaults with provided config
    if (upstash.enabled && upstash.url && upstash.token) {
        initialize({
            sessionLimit,
            sessionWindow,
            ipLimit,
            ipWindow,
            upstash: {
                url: upstash.url,
                token: upstash.token,
            }
        })

        const { success, pending, limit, reset, remaining } =
            await sessionRatelimit.limit(sessionId)

        if (!success) {
            console.warn(`Rate limit exceeded for session ID: ${sessionId}`)
            return errorResponse
        }

        const { success: ipSuccess } = await ipRatelimit.limit(ip)

        if (!ipSuccess) {
            console.warn(`Rate limit exceeded for IP: ${ip}`)
            return errorResponse
        }

        return response
    }

    // Check IP rate limit
    if (ip && handleRateLimiting(ip, ipLimit, windowMs || ipWindow * 1000)) {
        console.warn(`Rate limit exceeded for IP: ${ip}`)
        return errorResponse
    }

    // Check session rate limit
    if (handleRateLimiting(sessionId, sessionLimit, windowMs || sessionWindow * 1000)) {
        console.warn(`Rate limit exceeded for session ID: ${sessionId}`)
        return errorResponse
    }

    return response
}

export function handleRateLimiting(key: string, limit: number, windowMs: number) {
    const currentTime = Date.now()

    if (!rateLimitMap.has(key)) {
        rateLimitMap.set(key, [])
    }

    const timestamps = rateLimitMap.get(key) || []

    // Filter out timestamps that are outside the current window
    const validTimestamps = timestamps.filter(timestamp => (currentTime - timestamp) < windowMs)

    // Update the rate limit map with the valid timestamps
    rateLimitMap.set(key, validTimestamps)

    // Check if limit exceeded
    if (validTimestamps.length >= limit) {
        return true
    }

    // Add the current timestamp to the list
    validTimestamps.push(currentTime)
    return false
}