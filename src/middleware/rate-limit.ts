import type { MiddlewareHandler } from "hono"
import { redis } from "../queue.js"
import logger from "../logger.js"

const WINDOW_SECONDS = 60
const MAX_REQUESTS = 100

export const rateLimiter: MiddlewareHandler = async (c, next) => {
    const ip =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown"

    const key = `ratelimit:${ip}`

    const current = await redis.incr(key)

    if (current === 1) {
        await redis.expire(key, WINDOW_SECONDS)
    }

    if (current > MAX_REQUESTS) {
        logger.warn({ ip, current }, "Rate limit exceeded")
        return c.json({ status: "too many requests" }, 429)
    }

    await next()
}
