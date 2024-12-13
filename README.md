# NextJS Rate Limiting Middleware

Uses in-memory rate limiting for both session & IP. Doesn't require Redis, simple easy setup, and super basic protection from abuse.

# Installation

```bash
npm install @daveyplate/next-rate-limit
```

# Usage

Default limits are 30 requests per session within 15 seconds, and 300 requests per IP within 15 seconds (10 users)

```jsx
export function rateLimit({ 
    request, 
    response, 
    sessionLimit = 30, 
    ipLimit = 300, 
    windowMs = 15 * 1000 
})
```

middleware.js

```ts
import { NextResponse, NextRequest } from 'next/server'
import { rateLimit } from '@daveyplate/next-rate-limit'

export async function middleware(request: NextRequest) {
    const response = NextResponse.next()

    const rateLimitResponse = await rateLimit({ request, response })
    if (rateLimitResponse) return rateLimitResponse

    return response
}

// Apply middleware to all API routes
export const config = {
    matcher: '/api/:path*'
}
```
