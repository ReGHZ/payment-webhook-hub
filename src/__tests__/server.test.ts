/**
 * Unit tests untuk HTTP server (src/server.ts)
 *
 * Test ini memverifikasi semua endpoint dan middleware yang ada di server:
 *
 * 1. GET /health
 *    - Pastikan health check return OK ketika Redis terkoneksi
 *    - Pastikan return 503 ketika Redis mati (supaya orchestrator bisa restart)
 *
 * 2. POST /webhook/xendit
 *    - Signature verification: tolak request tanpa/dengan token yang salah (403)
 *    - Happy path: webhook valid diterima dan masuk ke queue (200)
 *    - Idempotency: webhook dengan Xendit ID yang sama tidak di-enqueue dua kali
 *    - Rate limiting: return 429 ketika request melebihi batas per menit
 *
 * Semua dependency (Redis, BullMQ queue, logger) di-mock supaya test
 * bisa jalan tanpa infrastructure. Pakai Hono `app.request()` untuk
 * simulasi HTTP request tanpa perlu start server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock queue module (Redis + BullMQ) — tidak perlu koneksi Redis asli
vi.mock("../queue.js", () => ({
    webhookQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    redis: {
        ping: vi.fn().mockResolvedValue("PONG"),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        set: vi.fn().mockResolvedValue("OK"),
    },
}))

vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Set token sebelum import server supaya signature verification aktif
vi.stubEnv("XENDIT_CALLBACK_TOKEN", "test-secret-token")

const { webhookQueue, redis } = await import("../queue.js")
const { default: app } = await import("../server.js")

const VALID_TOKEN = "test-secret-token"

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

    it("returns 503 ketika Redis mati — supaya load balancer tahu service unhealthy", async () => {
        vi.mocked(redis.ping).mockRejectedValueOnce(new Error("Connection refused"))
        const res = await makeRequest("/health")
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ status: "unhealthy", redis: "disconnected" })
    })
})

describe("POST /webhook/xendit", () => {
    /** Contoh payload Xendit yang valid */
    const validBody = {
        id: "xendit-event-123",
        external_id: "WULF-CAFE-001",
        amount: 50000,
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(redis.incr).mockResolvedValue(1)
        vi.mocked(redis.expire).mockResolvedValue(1)
        vi.mocked(redis.set).mockResolvedValue("OK")
        vi.mocked(webhookQueue.add).mockResolvedValue(undefined as never)
    })

    // --- Signature Verification ---

    it("tolak request tanpa x-callback-token header (403)", async () => {
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            body: validBody,
        })
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ status: "unauthorized" })
    })

    it("tolak request dengan token yang salah (403)", async () => {
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            headers: { "x-callback-token": "wrong-token-value" },
            body: validBody,
        })
        expect(res.status).toBe(403)
    })

    // --- Happy Path ---

    it("terima webhook valid, enqueue ke BullMQ, return 200 dengan ID", async () => {
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            headers: { "x-callback-token": VALID_TOKEN },
            body: validBody,
        })
        expect(res.status).toBe(200)
        const json = await res.json() as Record<string, unknown>
        expect(json.status).toBe("ok")
        expect(json.id).toBeDefined()
        expect(webhookQueue.add).toHaveBeenCalledOnce()
    })

    // --- Idempotency ---

    it("webhook dengan Xendit ID yang sama tidak di-enqueue dua kali (dedup)", async () => {
        // Request pertama: redis.set return "OK" (key baru, belum ada)
        vi.mocked(redis.set).mockResolvedValueOnce("OK")
        const res1 = await makeRequest("/webhook/xendit", {
            method: "POST",
            headers: { "x-callback-token": VALID_TOKEN },
            body: validBody,
        })
        expect(res1.status).toBe(200)

        // Request kedua (duplikat): redis.set return null (key sudah ada)
        vi.mocked(redis.set).mockResolvedValueOnce(null)
        const res2 = await makeRequest("/webhook/xendit", {
            method: "POST",
            headers: { "x-callback-token": VALID_TOKEN },
            body: validBody,
        })
        expect(res2.status).toBe(200)
        const json = await res2.json() as Record<string, unknown>
        expect(json.duplicate).toBe(true)

        // Queue hanya dipanggil sekali (request pertama saja)
        expect(webhookQueue.add).toHaveBeenCalledOnce()
    })

    // --- Rate Limiting ---

    it("return 429 ketika request melebihi rate limit (100 req/menit)", async () => {
        // Simulasi: redis.incr return 101 (sudah melebihi batas)
        vi.mocked(redis.incr).mockResolvedValueOnce(101)
        const res = await makeRequest("/webhook/xendit", {
            method: "POST",
            headers: { "x-callback-token": VALID_TOKEN },
            body: validBody,
        })
        expect(res.status).toBe(429)
    })
})
