/**
 * Unit tests untuk Webhook Verification (src/verify.ts)
 *
 * Test ini memverifikasi semua metode verifikasi webhook:
 *
 * 1. header-token — simple token comparison (Xendit-style)
 * 2. hmac-sha256 — HMAC signature verification
 * 3. hmac-sha512 — HMAC signature verification (Midtrans-style)
 * 4. stripe-signature — Stripe's t=timestamp,v1=signature format
 * 5. none — always passes (untuk testing/internal)
 * 6. Edge cases — missing env var, missing header, empty values
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "node:crypto"
import { verifyWebhook } from "../verify.js"
import type { ProviderConfig } from "../types.js"

function makeProvider(
    verify: ProviderConfig["verify"],
    overrides?: Partial<ProviderConfig>,
): ProviderConfig {
    return {
        name: "test",
        enabled: true,
        routingField: "id",
        ...overrides,
        verify,
    }
}

describe("verifyWebhook", () => {
    beforeEach(() => {
        vi.unstubAllEnvs()
    })

    describe("header-token", () => {
        const provider = makeProvider({
            method: "header-token",
            headerName: "x-callback-token",
            envKey: "TEST_TOKEN",
        })

        it("return true kalau token cocok", () => {
            vi.stubEnv("TEST_TOKEN", "secret-123")
            const result = verifyWebhook(provider, { "x-callback-token": "secret-123" }, "{}")
            expect(result).toBe(true)
        })

        it("return false kalau token tidak cocok", () => {
            vi.stubEnv("TEST_TOKEN", "secret-123")
            const result = verifyWebhook(provider, { "x-callback-token": "wrong" }, "{}")
            expect(result).toBe(false)
        })

        it("return false kalau env var kosong", () => {
            vi.stubEnv("TEST_TOKEN", "")
            const result = verifyWebhook(provider, { "x-callback-token": "anything" }, "{}")
            expect(result).toBe(false)
        })

        it("return false kalau header tidak ada", () => {
            vi.stubEnv("TEST_TOKEN", "secret-123")
            const result = verifyWebhook(provider, {}, "{}")
            expect(result).toBe(false)
        })
    })

    describe("hmac-sha256", () => {
        const provider = makeProvider({
            method: "hmac-sha256",
            headerName: "x-signature",
            envKey: "HMAC_SECRET",
        })

        it("return true kalau HMAC signature valid", () => {
            const secret = "my-secret"
            const body = '{"amount":50000}'
            const signature = createHmac("sha256", secret).update(body).digest("hex")

            vi.stubEnv("HMAC_SECRET", secret)
            const result = verifyWebhook(provider, { "x-signature": signature }, body)
            expect(result).toBe(true)
        })

        it("return false kalau signature salah", () => {
            vi.stubEnv("HMAC_SECRET", "my-secret")
            const result = verifyWebhook(provider, { "x-signature": "invalid-sig" }, '{"a":1}')
            expect(result).toBe(false)
        })
    })

    describe("hmac-sha512", () => {
        const provider = makeProvider({
            method: "hmac-sha512",
            headerName: "x-signature",
            envKey: "HMAC_SECRET",
        })

        it("return true kalau HMAC-SHA512 signature valid", () => {
            const secret = "midtrans-key"
            const body = '{"order_id":"ORD-001"}'
            const signature = createHmac("sha512", secret).update(body).digest("hex")

            vi.stubEnv("HMAC_SECRET", secret)
            const result = verifyWebhook(provider, { "x-signature": signature }, body)
            expect(result).toBe(true)
        })

        it("return false kalau signature salah", () => {
            vi.stubEnv("HMAC_SECRET", "midtrans-key")
            const result = verifyWebhook(provider, { "x-signature": "bad" }, '{"a":1}')
            expect(result).toBe(false)
        })
    })

    describe("stripe-signature", () => {
        const provider = makeProvider({
            method: "stripe-signature",
            headerName: "stripe-signature",
            envKey: "STRIPE_SECRET",
        })

        it("return true kalau Stripe signature valid", () => {
            const secret = "whsec_test"
            const body = '{"id":"evt_123"}'
            const timestamp = "1234567890"
            const payload = `${timestamp}.${body}`
            const signature = createHmac("sha256", secret).update(payload).digest("hex")

            vi.stubEnv("STRIPE_SECRET", secret)
            const header = `t=${timestamp},v1=${signature}`
            const result = verifyWebhook(provider, { "stripe-signature": header }, body)
            expect(result).toBe(true)
        })

        it("return false kalau timestamp/signature format salah", () => {
            vi.stubEnv("STRIPE_SECRET", "whsec_test")
            const result = verifyWebhook(provider, { "stripe-signature": "invalid" }, "{}")
            expect(result).toBe(false)
        })

        it("return false kalau signature tidak cocok", () => {
            vi.stubEnv("STRIPE_SECRET", "whsec_test")
            const header = "t=123,v1=wrong-signature"
            const result = verifyWebhook(provider, { "stripe-signature": header }, "{}")
            expect(result).toBe(false)
        })
    })

    describe("none", () => {
        const provider = makeProvider({ method: "none" })

        it("always return true", () => {
            const result = verifyWebhook(provider, {}, "{}")
            expect(result).toBe(true)
        })
    })
})
