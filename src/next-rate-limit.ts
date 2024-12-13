import { NextResponse, NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'

const rateLimitMap = new Map<string, number[]>()


/**
 * This middleware is used to rate limit requests based
 * on IP address and session ID. Returns NextResponse with 
 * 429 status code if the rate limit is exceeded.
 * @param {object} options - Rate limiting options.
 * @param {NextRequest} options.request - Incoming request object.
 * @param {NextResponse} options.response - NextResponse object.
 * @param {number} [options.sessionLimit=30] - Number of requests allowed per session in the window.
 * @param {number} [options.ipLimit=300] - Number of requests allowed per IP in the window.
 * @param {number} [options.windowMs=15000] - Time window in milliseconds.
 */
export async function rateLimit({
    request,
    response,
    sessionLimit = 30,
    ipLimit = 300,
    windowMs = 15 * 1000
}: { request: NextRequest; response: NextResponse; sessionLimit?: number; ipLimit?: number; windowMs?: number }) {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip")
    let sessionId = (await cookies()).get('session_id')?.value

    if (!sessionId) {
        sessionId = uuidv4()
        response.cookies.set("session_id", sessionId)
    }

    // Check IP rate limit
    if (ip && handleRateLimiting(ip, ipLimit, windowMs)) {
        const response = { message: "Too Many Requests" }
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
        const response = { message: "Too Many Requests" }
        console.warn(`Rate limit exceeded for session ID: ${sessionId}`)
        return new NextResponse(JSON.stringify(response), {
            status: 429,
            headers: {
                "Content-Type": "application/json"
            }
        })
    }

    return null
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
