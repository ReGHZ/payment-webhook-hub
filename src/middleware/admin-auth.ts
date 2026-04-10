import { timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import logger from "../logger.js"

const ADMIN_BEARER_TOKEN = process.env.ADMIN_BEARER_TOKEN ?? ""

export const adminAuth: MiddlewareHandler = async (c, next) => {
    if (ADMIN_BEARER_TOKEN.length === 0) {
        logger.error("ADMIN_BEARER_TOKEN is not configured")
        return c.json({ status: "server misconfigured" }, 500)
    }

    const header = c.req.header("authorization") ?? ""
    if (!header.startsWith("Bearer ")) {
        return c.json({ status: "unauthorized" }, 401)
    }

    const token = header.slice(7)

    if (
        token.length !== ADMIN_BEARER_TOKEN.length ||
        !timingSafeEqual(
            Buffer.from(token),
            Buffer.from(ADMIN_BEARER_TOKEN)
        )
    ) {
        logger.warn("Invalid admin bearer token")
        return c.json({ status: "forbidden" }, 403)
    }

    await next()
}
