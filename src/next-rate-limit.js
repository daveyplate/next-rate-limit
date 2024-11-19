import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'

const rateLimitMap = new Map()

/**
 * This middleware is used to rate limit requests based
 * on IP address and session ID. Returns NextResponse with 
 * 429 status code if the rate limit is exceeded.
 * @param {object} options - Rate limiting options.
 * @param {NextRequest} options.request - Incoming request object.
 * @param {NextResponse} options.response - NextResponse object.
 * @param {number} [options.sessionLimit=30] - Number of requests allowed per session in the window.
 * @param {number} [options.ipLimit=300] - Number of requests allowed per IP in the window.
 * @param {number} [options.windowMs=10000] - Time window in milliseconds.
 * @returns {NextResponse?} - Rate Limit response if exceeded.
 */
export function rateLimit({
    request,
    response,
    sessionLimit = 30,
    ipLimit = 300,
    windowMs = 10 * 1000
}) {
    const ip = request.headers.get("x-forwarded-for") || request.ip
    let sessionId = cookies().get('session_id')?.value

    if (!sessionId) {
        sessionId = uuidv4()
        response.cookies.set("session_id", sessionId)
    }

    // Check IP rate limit
    if (handleRateLimiting(ip, ipLimit, windowMs)) {
        const response = { error: { message: "Too Many Requests" } }
        console.warn(`Rate limit exceeded for IP: ${ip}`)
        return new NextResponse(JSON.stringify(response), {
            status: 429,
            headers: {
                "Content-Type": "application/json"
            }
        })
    }

    // Check session rate limit
    if (handleRateLimiting(sessionId, sessionLimit, windowMs)) {
        const response = { error: { message: "Too Many Requests" } }
        console.warn(`Rate limit exceeded for session ID: ${sessionId}`)
        return new NextResponse(JSON.stringify(response), {
            status: 429,
            headers: {
                "Content-Type": "application/json"
            }
        })
    }
}

/**
 * Function to handle rate limiting.
 * @param {string} key - Key to identify the rate limit.
 * @param {number} limit - Number of requests allowed in the window.
 * @param {number} windowMs - Time window in milliseconds.
 * @returns {boolean} - Indicate if the rate limit is exceeded.
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
