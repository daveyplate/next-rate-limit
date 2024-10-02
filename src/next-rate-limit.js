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
    const currentTime = Date.now()

    if (!rateLimitMap.has(key)) {
        rateLimitMap.set(key, [])
    }

    const timestamps = rateLimitMap.get(key)

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
export function rateLimit({
    request,
    nextResponse,
    sessionLimit = 30,
    ipLimit = 300,
    windowMs = 10 * 1000
}) {
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

    return nextResponse
}