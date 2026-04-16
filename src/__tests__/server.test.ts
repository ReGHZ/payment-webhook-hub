/**
 * Unit tests untuk HTTP server (src/server.ts)
 *
 * Test ini memverifikasi semua endpoint dan middleware yang ada di server:
 *
 * 1. GET /health
 *    - Pastikan health check return OK ketika Redis terkoneksi
 *    - Pastikan return 503 ketika Redis mati (supaya orchestrator bisa restart)
 *
 * 2. POST /webhook/:provider
 *    - Unknown provider return 404
 *    - Verification failed return 403
 *    - Happy path: webhook valid diterima dan masuk ke queue (200)
 *    - Idempotency: webhook dengan ID yang sama tidak di-enqueue dua kali
 *    - Rate limiting: return 429 ketika request melebihi batas per menit
 *
 * Semua dependency (Redis, BullMQ queue, logger, providers, verify) di-mock
 * supaya test bisa jalan tanpa infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../queue.js", () => ({
    webhookQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    forwardQueue: {},
    dlq: {},
    redis: {
        ping: vi.fn().mockResolvedValue("PONG"),
        set: vi.fn().mockResolvedValue("OK"),
        pipeline: vi.fn().mockReturnValue({
            incr: vi.fn().mockReturnThis(),
            expire: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]),
        }),
    },
}))

vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

vi.mock("../providers.js", () => ({
    getProvider: vi.fn(),
}))

vi.mock("../verify.js", () => ({
    verifyWebhook: vi.fn().mockReturnValue(true),
}))

vi.mock("@bull-board/api", () => ({
    createBullBoard: vi.fn(),
}))

vi.mock("@bull-board/api/bullMQAdapter", () => ({
    BullMQAdapter: vi.fn(),
}))

vi.mock("@bull-board/hono", async () => {
    const { Hono } = await import("hono")
    return {
        HonoAdapter: class {
            setBasePath() { return this }
            registerPlugin() { return new Hono() }
        }
    }
})

vi.mock("@hono/node-server/serve-static", () => ({
    serveStatic: vi.fn(),
}))

const { webhookQueue, redis } = await import("../queue.js")
const { getProvider } = await import("../providers.js")
const { verifyWebhook } = await import("../verify.js")
const { default: app } = await import("../server.js")

const xenditProvider = {
    name: "xendit",
    enabled: true,
    routingField: "external_id",
    dedupField: "id",
    verify: {
        method: "header-token" as const,
        headerName: "x-callback-token",
        envKey: "XENDIT_CALLBACK_TOKEN",
    },
}

/** Helper: buat HTTP request ke Hono app tanpa perlu start server */
function makeRequest(
    path: string,
    options: {
        method?: string
        headers?: Record<string, string>
        body?: unknown
    } = {}
) {
    const { method = "GET", headers = {}, body } = options
    return app.request(path, {
        method,
        headers: {
            "content-type": "application/json",
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
}

describe("GET /health", () => {
    it("returns 200 OK ketika Redis terkoneksi", async () => {
        const res = await makeRequest("/health")
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: "ok" })
    })

    it("returns 503 ketika Redis mati", async () => {
        vi.mocked(redis.ping).mockRejectedValueOnce(new Error("Connection refused"))
        const res = await makeRequest("/health")
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ status: "unhealthy", redis: "disconnected" })
    })
})

describe("POST /webhook/:provider", () => {
    const validBody = {
        id: "xendit-event-123",
        external_id: "WULF-CAFE-001",
        amount: 50000,
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getProvider).mockReturnValue(xenditProvider)
        vi.mocked(verifyWebhook).mockReturnValue(true)
        vi.mocked(redis.set).mockResolvedValue("OK")
        vi.mocked(redis.pipeline).mockReturnValue({
            incr: vi.fn().mockReturnThis(),
            expire: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([[null, 1], [null, 1]]),
        } as never)
        vi.mocked(webhookQueue.add).mockResolvedValue(undefined as never)
    })

    // --- Unknown Provider ---

    it("return 404 untuk provider yang tidak terdaftar", async () => {
        vi.mocked(getProvider).mockReturnValue(undefined)
        const res = await makeRequest("/webhook/unknown", {
            method: "POST",
            body: validBody,
        })
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ status: "unknown provider" })
    })

    // --- Verification ---

    it("return 403 kalau verification gagal", async () => {
        vi.mocked(verifyWebhook).mockReturnValue(false)
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ status: "unauthorized" })
    })

    // --- Happy Path ---

    it("terima webhook valid, enqueue ke BullMQ, return 200 dengan ID", async () => {
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res.status).toBe(200)
        const json = await res.json() as Record<string, unknown>
        expect(json.status).toBe("ok")
        expect(json.id).toBeDefined()
        expect(webhookQueue.add).toHaveBeenCalledOnce()

        // Job data harus include provider
        const call = vi.mocked(webhookQueue.add).mock.calls[0]!
        expect((call[1] as { provider: string }).provider).toBe("xendit")
    })

    // --- Idempotency ---

    it("webhook dengan ID yang sama tidak di-enqueue dua kali (dedup)", async () => {
        vi.mocked(redis.set).mockResolvedValueOnce("OK")
        const res1 = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res1.status).toBe(200)

        vi.mocked(redis.set).mockResolvedValueOnce(null)
        const res2 = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res2.status).toBe(200)
        const json = await res2.json() as Record<string, unknown>
        expect(json.duplicate).toBe(true)

        expect(webhookQueue.add).toHaveBeenCalledOnce()
    })

    // --- Rate Limiting ---

    it("return 429 ketika request melebihi rate limit", async () => {
        vi.mocked(redis.pipeline).mockReturnValueOnce({
            incr: vi.fn().mockReturnThis(),
            expire: vi.fn().mockReturnThis(),
            exec: vi.fn().mockResolvedValue([[null, 101], [null, 1]]),
        } as never)
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res.status).toBe(429)
    })
})
