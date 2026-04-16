import { timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import logger from "../logger.js"

const ADMIN_BEARER_TOKEN = process.env.ADMIN_BEARER_TOKEN ?? ""
const ADMIN_USER = process.env.ADMIN_USER ?? "admin"

function checkToken(token: string): boolean {
    return (
        token.length === ADMIN_BEARER_TOKEN.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_BEARER_TOKEN))
    )
}

export const adminAuth: MiddlewareHandler = async (c, next) => {
    if (ADMIN_BEARER_TOKEN.length === 0) {
        logger.error("ADMIN_BEARER_TOKEN is not configured")
        return c.json({ status: "server misconfigured" }, 500)
    }

    const header = c.req.header("authorization") ?? ""

    // bearer (API/curl)
    if (header.startsWith("Bearer ")) {
        const token = header.slice(7)
        if (checkToken(token)) {
            await next()
            return
        }
        logger.warn("Invalid admin bearer token")
        return c.json({ status: "forbidden" }, 403)
    }

    // basic auth (browser)
    if (header.startsWith("Basic ")) {
        const decoded = Buffer.from(header.slice(6), "base64").toString()
        const separator = decoded.indexOf(":")
        if (separator !== -1) {
            const user = decoded.slice(0, separator)
            const pass = decoded.slice(separator + 1)
            if (user === ADMIN_USER && checkToken(pass)) {
                await next()
                return
            }
        }
        logger.warn("Invalid admin basic auth")
    }

    c.header("WWW-Authenticate", 'Basic realm="Admin"')
    return c.text("Unauthorized", 401)
}
