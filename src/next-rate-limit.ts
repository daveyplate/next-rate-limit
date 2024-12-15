import { IncomingMessage, ServerResponse } from "http"
import { LRUCache } from "lru-cache"
import { Redis } from "@upstash/redis"
import { Duration, Ratelimit } from "@upstash/ratelimit"

let currentConfig: any = {}
let tokenCache: LRUCache<string, { count: number, reset: number }>
let redis: Redis
let ratelimit: Ratelimit

function initialize({ limit, window, upstash }: Partial<RateLimitOptions>) {
    // Re-initialize on Config change for development
    const config = { limit, window, upstash }

    if (JSON.stringify(config) != JSON.stringify(currentConfig)) {
        currentConfig = config

        // Prepare the LRU Cache
        tokenCache = new LRUCache<string, { count: number, reset: number }>({
            max: limit!,
            ttl: window! * 1000,
            ttlAutopurge: true
        })

        // Initialize Upstash Redis & Ratelimit
        const { enabled, url, token, analytics, sliding } = upstash!

        if (enabled && url && token) {
            redis = new Redis({
                url: url,
                token: token
            })

            ratelimit = new Ratelimit({
                redis,
                limiter: (sliding ?
                    Ratelimit.slidingWindow(limit!, `${window} s` as Duration)
                    : Ratelimit.fixedWindow(limit!, `${window} s` as Duration)
                ),
                analytics
            })
        }
    }
}

interface RateLimitOptions {
    request?: Request | null
    response?: Response | null
    req?: IncomingMessage | null
    res?: ServerResponse | null
    identifier?: string | null
    limit?: number
    window?: number
    upstash?: {
        enabled?: boolean
        url?: string | null
        token?: string | null
        sliding?: boolean
        analytics?: boolean
    }
}

interface RateLimitResponse {
    success: boolean
    remaining: number
    reset: number
    rateLimitedResponse?: Response | null
    pending?: Promise<unknown>
}

/**
 * This middleware is used to rate limit API requests based
 * on an identifier or IP address. Returns rateLimitedResponse as Response with 
 * 429 if the rate limit is exceeded. Pass Response or res to have headers added.
 * 
 * @param {RateLimitOptions} options - Rate limiting options.
 * @param {Request} options.request - Request object (NextRequest)
 * @param {Response} options.response - Response object (NextResponse)
 * @param {IncomingMessage} options.req - IncomingMessage object (NextApiRequest)
 * @param {ServerResponse} options.res - ServerResponse object (NextApiResponse)
 * @param {string} [options.identifier] - Identifier for rate limiting, falls back to IP.
 * @param {number} [options.limit] - Number of requests allowed during the window.
 * @param {number} [options.window] - Window in seconds for rate limiting.
 * @param {object} [options.upstash] - Upstash Redis configuration.
 * @param {boolean} [options.upstash.enabled] - Enable Upstash Redis rate limiting.
 * @param {string} [options.upstash.url] - Upstash Redis REST URL.
 * @param {string} [options.upstash.token] - Upstash Redis REST token.
 * @param {boolean} [options.upstash.sliding] - Enable sliding window rate limiting.
 * @param {boolean} [options.upstash.analytics] - Enable analytics for rate limiting.
 */
export async function rateLimit({
    request,
    response,
    req,
    res,
    identifier,
    limit = 60,
    window = 60,
    upstash = {},
}: RateLimitOptions): Promise<RateLimitResponse> {
    if (!req && !request && !identifier) throw new Error("Either Request or Identifier is Required")

    // Prepare the identifier and fallback to IP (pop XFF to prevent spoofing)
    if (req) {
        identifier = identifier || (req.headers["x-forwarded-for"] as string)?.split(',').pop()?.trim() || req.socket.remoteAddress || '127.0.0.1'
    }

    if (request) {
        identifier = identifier || request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || (request as any).ip || request.headers.get('x-real-ip') || request.headers.get('x-client-ip') || '127.0.0.1'
    }

    // Initialize LRU & Upstash Redis
    upstash.url = upstash.url || process.env.UPSTASH_REDIS_REST_URL
    upstash.token = upstash.token || process.env.UPSTASH_REDIS_REST_TOKEN

    initialize({
        limit,
        window,
        upstash: {
            ...upstash,
            url: upstash.url,
            token: upstash.token,
        }
    })

    const rateLimitedResponse = Response.json({ message: "Too Many Requests" }, { status: 429 })

    // Check for and append CORS headers from original response
    response?.headers?.forEach((value, key) => {
        if (key.toLowerCase().startsWith('access-control-')) {
            rateLimitedResponse.headers.set(key, value)
            res?.setHeader(key, value)
        }
    })

    // Set the limit headers
    response?.headers.set('X-RateLimit-Limit', limit.toString())
    rateLimitedResponse.headers.set('X-RateLimit-Limit', limit.toString())
    res?.setHeader('X-RateLimit-Limit', limit)

    // LRU Cache Rate Limit
    let { success, remaining, reset } = await checkRateLimit(identifier!, limit, window)

    response?.headers.set('X-RateLimit-Remaining', remaining.toString())
    response?.headers.set('X-RateLimit-Reset', reset.toString())
    res?.setHeader('X-RateLimit-Remaining', remaining)
    res?.setHeader('X-RateLimit-Reset', reset)

    if (!success) {
        console.warn(`LRU Cache Rate Limit Exceeded for Identifier: ${identifier}`)

        rateLimitedResponse.headers.set('X-RateLimit-Remaining', remaining.toString())
        rateLimitedResponse.headers.set('X-RateLimit-Reset', reset.toString())

        const nextRes = res as any
        nextRes?.status(429).json({ message: "Too Many Requests" })

        return { success, remaining, reset, rateLimitedResponse }
    }

    // Upstash Rate Limit
    if (upstash.enabled && upstash.url && upstash.token) {
        const upstashResult = await ratelimit.limit(identifier!)

        reset = Math.max(reset, Math.ceil(upstashResult.reset / 1000))
        remaining = Math.min(remaining, upstashResult.remaining)
        success = upstashResult.success

        response?.headers.set('X-RateLimit-Remaining', remaining.toString())
        response?.headers.set('X-RateLimit-Reset', reset.toString())
        res?.setHeader('X-RateLimit-Remaining', remaining)
        res?.setHeader('X-RateLimit-Reset', reset)

        // Update LRU cache with latest values from Upstash
        tokenCache.set(identifier!, { count: limit - remaining, reset: reset })

        if (!success) {
            console.warn(`Upstash Rate Limit Exceeded for Identifier: ${identifier}`)

            rateLimitedResponse.headers.set('X-RateLimit-Remaining', remaining.toString())
            rateLimitedResponse.headers.set('X-RateLimit-Reset', reset.toString())

            const nextRes = res as any
            nextRes?.status(429).json({ message: "Too Many Requests" })

            return { success, pending: upstashResult.pending, reset, remaining, rateLimitedResponse }
        }
    }

    return { success: true, reset, remaining }
}

const checkRateLimit = async (identifier: string, limit: number, window: number) => {
    const now = Date.now()
    let tokenData = tokenCache.get(identifier)

    if (!tokenData) {
        tokenData = { count: 0, reset: now + window }
        tokenCache.set(identifier, tokenData)
    }

    tokenData.count += 1

    const currentUsage = tokenData.count
    const success = currentUsage <= limit
    const remaining = success ? limit - currentUsage : 0
    const reset = Math.ceil(tokenData.reset / 1000)

    return { success, remaining, reset }
}