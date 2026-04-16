import { timingSafeEqual, createHmac } from "node:crypto"
import type { ProviderConfig } from "./types.js"

function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function verifyWebhook(
    provider: ProviderConfig,
    headers: Record<string, string>,
    rawBody: string,
): boolean {
    const { verify } = provider

    if (verify.method === "none") return true

    const secret = process.env[verify.envKey] ?? ""
    if (secret === "") return false

    const headerValue = headers[verify.headerName] ?? ""
    if (headerValue === "") return false

    switch (verify.method) {
        case "header-token":
            return safeCompare(headerValue, secret)

        case "hmac-sha256":
            return safeCompare(
                createHmac("sha256", secret).update(rawBody).digest("hex"),
                headerValue,
            )

        case "hmac-sha512":
            return safeCompare(
                createHmac("sha512", secret).update(rawBody).digest("hex"),
                headerValue,
            )

        case "stripe-signature": {
            // stripe: t=timestamp,v1=signature
            const parts = Object.fromEntries(
                headerValue.split(",").map((p) => {
                    const [k, ...v] = p.split("=")
                    return [k, v.join("=")]
                }),
            )
            const timestamp = parts.t
            const signature = parts.v1
            if (timestamp == null || signature == null) return false

            const payload = `${timestamp}.${rawBody}`
            const expected = createHmac("sha256", secret)
                .update(payload)
                .digest("hex")
            return safeCompare(expected, signature)
        }

        default:
            return false
    }
}
