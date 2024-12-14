# NextJS Rate Limiting Middleware

Uses in-memory rate limiting for both session & IP. Simple easy setup, and super basic protection from abuse. Now supports Upstash configuration for distributed rate limiting.

# Installation

```bash
npm install @daveyplate/next-rate-limit
```

# Usage

Default limits are 20 requests per session within 10 seconds, and 100 requests per IP within 10 seconds.

```ts
export function rateLimit({ 
    request, 
    response, 
    sessionLimit = 20, 
    ipLimit = 100, 
    sessionWindow = 10, 
    ipWindow = 10, 
    upstash = { 
        enabled: false, 
        url: process.env.UPSTASH_REDIS_REST_URL, 
        token: '', 
        analytics: false
    } 
})
```

middleware.js

```ts
import { NextResponse, NextRequest } from 'next/server'
import { rateLimit } from '@daveyplate/next-rate-limit'

export async function middleware(request: NextRequest) {
    const response = NextResponse.next()

    return await rateLimit({ request, response })
}

// Apply middleware to all API routes
export const config = {
    matcher: '/api/:path*'
}
```

# Upstash Configuration

To enable Upstash, you can configure it using environment variables or by passing the configuration directly.

## Environment Variables

Set the following environment variables in your `.env` file:

```
UPSTASH_REDIS_REST_URL=<your_upstash_redis_rest_url>
UPSTASH_REDIS_REST_TOKEN=<your_upstash_redis_rest_token>
```

## Passing Configuration Directly

You can also pass the Upstash configuration directly when calling `rateLimit`:

```tsx
const rateLimitResponse = await rateLimit({ 
    request, 
    response, 
    upstash: {
        enabled: true,
        url: '<your_upstash_redis_rest_url>',
        token: '<your_upstash_redis_rest_token>',
        analytics: true
    }
})
```