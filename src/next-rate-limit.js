import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'

const rateLimitMap = new Map()

/**
 * Function to handle rate limiting
 * @param {string} key - Key to identify the rate limit
 * @param {number} limit - Number of requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} - Indicate if the rate limit is exceeded
 */
export function handleRateLimiting(key, limit, windowMs) {
    if (!rateLimitMap.has(key)) {
        rateLimitMap.set(key, {
            count: 0,
            lastReset: Date.now(),
        })
    }

    const data = rateLimitMap.get(key)

    // Reset count if the window has expired
    if (Date.now() - data.lastReset > windowMs) {
        data.count = 0
        data.lastReset = Date.now()
    }

    // Check if limit exceeded
    if (data.count >= limit) {
        return true // Indicate limit exceeded
    }

    // Increment count
    data.count += 1
    return false // Indicate not exceeded
}

/**
 * NextJS Rate Limiting Middleware
 * This middleware can be used to rate limit requests based
 * on IP address and session ID. Returns NextResponse with 
 * 429 status code if the rate limit is exceeded.
 * @param {object} options - Rate limiting options
 * @param {NextRequest} options.request - Incoming request object
 * @param {NextResponse} options.nextResponse - NextResponse object
 * @param {number} options.ipLimit - Number of requests allowed per IP in the window
 * @param {number} options.sessionLimit - Number of requests allowed per session in the window
 * @param {number} options.windowMs - Time window in milliseconds
 * @returns {NextResponse?} - Rate Limit response if exceeded
 */
export function rateLimit({ request, nextResponse, ipLimit = 300, sessionLimit = 30, windowMs = 15 * 1000 }) {
    const ip = request.headers.get("x-forwarded-for") || request.ip
    let sessionId = cookies().get('session_id')?.value

    if (!sessionId) {
        sessionId = uuidv4()
        nextResponse.cookies.set("session_id", sessionId)
    }

    // Check IP rate limit
    if (handleRateLimiting(ip, ipLimit, windowMs)) {
        return new NextResponse("Too Many Requests - IP Limit", {
            status: 429,
        })
    }

    // Check session rate limit
    if (handleRateLimiting(sessionId, sessionLimit, windowMs)) {
        return new NextResponse("Too Many Requests - Session Limit", {
            status: 429,
        })
    }
}
