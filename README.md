# NextJS Rate Limiting Middleware

Uses in-memory rate limiting for both session & IP. More instructions WIP.

# Installation

```
npm install @daveyplate/next-rate-limit
```

# Usage

```
export function rateLimit({ request, nextResponse, ipLimit = 300, sessionLimit = 30, windowMs = 15 * 1000 }) {
```

middleware.js
```
import { NextResponse } from 'next/server'
import { rateLimit } from '@daveyplate/next-rate-limit'

export function middleware(request) {
    const nextResponse = NextResponse.next()

    const rateLimitResponse = rateLimit({ request, nextResponse })
    if (rateLimitResponse) return rateLimitResponse

    return nextResponse
}

// Apply middleware to all API routes
export const config = {
    matcher: '/api/:path*'
}
```