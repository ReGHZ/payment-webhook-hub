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

    try {
        // atomic incr + expire
        const results = await redis
            .pipeline()
            .incr(key)
            .expire(key, WINDOW_SECONDS)
            .exec()

        const current = results?.[0]?.[1] as number ?? 0

        if (current > MAX_REQUESTS) {
            logger.warn({ ip, current }, "Rate limit exceeded")
            return c.json({ status: "too many requests" }, 429)
        }
    } catch (err) {
        // redis down skip, jangan block webhook
        logger.error({ err }, "Rate limiter redis error, skipping")
    }

    await next()
}
