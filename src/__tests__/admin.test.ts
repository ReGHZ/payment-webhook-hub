/**
 * Unit tests untuk Admin DLQ endpoints (src/server.ts)
 *
 * Endpoint ini dipakai untuk manage Dead Letter Queue (failed jobs)
 * tanpa perlu frontend — cukup akses via curl/Postman.
 *
 * Semua endpoint di-protect dengan bearer token (ADMIN_BEARER_TOKEN).
 *
 * 1. GET /admin/dlq
 *    - List semua job yang ada di DLQ
 *    - Bisa limit jumlah job via query param ?limit=N
 *    - Tanpa token → 401, token salah → 403
 *
 * 2. POST /admin/dlq/:jobId/replay
 *    - Ambil job dari DLQ, kirim ulang ke forward queue
 *    - Job dihapus dari DLQ setelah berhasil di-replay
 *    - jobId tidak ditemukan → 404
 *
 * 3. DELETE /admin/dlq/:jobId
 *    - Hapus job dari DLQ (untuk job yang memang tidak perlu di-replay)
 *    - jobId tidak ditemukan → 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../queue.js", () => ({
    webhookQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    forwardQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    dlq: {
        getJobs: vi.fn().mockResolvedValue([]),
        getJob: vi.fn().mockResolvedValue(null),
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

vi.stubEnv("XENDIT_CALLBACK_TOKEN", "test-secret-token")
vi.stubEnv("ADMIN_BEARER_TOKEN", "test-admin-token")

const { forwardQueue, dlq } = await import("../queue.js")
const { default: app } = await import("../server.js")

const VALID_ADMIN_TOKEN = "test-admin-token"

/** Helper: buat HTTP request ke Hono app */
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

/** Helper: buat auth header dengan bearer token */
function authHeader(token = VALID_ADMIN_TOKEN) {
    return { authorization: `Bearer ${token}` }
}

describe("Admin DLQ endpoints - authentication", () => {
    it("return 401 jika tidak ada Authorization header", async () => {
        const res = await makeRequest("/admin/dlq")
        expect(res.status).toBe(401)
    })

    it("return 401 jika Authorization header bukan Bearer format", async () => {
        const res = await makeRequest("/admin/dlq", {
            headers: { authorization: "Basic abc123" },
        })
        expect(res.status).toBe(401)
    })

    it("return 403 jika bearer token salah", async () => {
        const res = await makeRequest("/admin/dlq", {
            headers: authHeader("wrong-token"),
        })
        expect(res.status).toBe(403)
    })
})

describe("GET /admin/dlq", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("return list DLQ jobs (empty)", async () => {
        vi.mocked(dlq.getJobs).mockResolvedValueOnce([])

        const res = await makeRequest("/admin/dlq", {
            headers: authHeader(),
        })
        expect(res.status).toBe(200)
        const json = await res.json() as { count: number; jobs: unknown[] }
        expect(json.count).toBe(0)
        expect(json.jobs).toEqual([])
    })

    it("return list DLQ jobs dengan data", async () => {
        vi.mocked(dlq.getJobs).mockResolvedValueOnce([
            {
                id: "job-1",
                data: { webhook: { id: "wh-1" }, failedReason: "HTTP 500" },
                timestamp: 1234567890,
            },
        ] as never)

        const res = await makeRequest("/admin/dlq", {
            headers: authHeader(),
        })
        expect(res.status).toBe(200)
        const json = await res.json() as { count: number; jobs: unknown[] }
        expect(json.count).toBe(1)
    })
})

describe("POST /admin/dlq/:jobId/replay", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("return 404 jika job tidak ditemukan", async () => {
        vi.mocked(dlq.getJob).mockResolvedValueOnce(undefined as never)

        const res = await makeRequest("/admin/dlq/nonexistent/replay", {
            method: "POST",
            headers: authHeader(),
        })
        expect(res.status).toBe(404)
    })

    it("replay job: re-add ke forwardQueue dan hapus dari DLQ", async () => {
        const mockJob = {
            id: "job-1",
            data: {
                webhook: { id: "wh-1", body: { amount: 5000 } },
                target: { name: "cafe", url: "http://localhost" },
            },
            remove: vi.fn().mockResolvedValue(undefined),
        }
        vi.mocked(dlq.getJob).mockResolvedValueOnce(mockJob as never)
        vi.mocked(forwardQueue.add).mockResolvedValueOnce(undefined as never)

        const res = await makeRequest("/admin/dlq/job-1/replay", {
            method: "POST",
            headers: authHeader(),
        })
        expect(res.status).toBe(200)
        const json = await res.json() as { replayed: string }
        expect(json.replayed).toBe("job-1")
        expect(forwardQueue.add).toHaveBeenCalledOnce()
        expect(mockJob.remove).toHaveBeenCalledOnce()
    })
})

describe("DELETE /admin/dlq/:jobId", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("return 404 jika job tidak ditemukan", async () => {
        vi.mocked(dlq.getJob).mockResolvedValueOnce(undefined as never)

        const res = await makeRequest("/admin/dlq/nonexistent", {
            method: "DELETE",
            headers: authHeader(),
        })
        expect(res.status).toBe(404)
    })

    it("hapus job dari DLQ", async () => {
        const mockJob = {
            id: "job-1",
            remove: vi.fn().mockResolvedValue(undefined),
        }
        vi.mocked(dlq.getJob).mockResolvedValueOnce(mockJob as never)

        const res = await makeRequest("/admin/dlq/job-1", {
            method: "DELETE",
            headers: authHeader(),
        })
        expect(res.status).toBe(200)
        const json = await res.json() as { removed: string }
        expect(json.removed).toBe("job-1")
        expect(mockJob.remove).toHaveBeenCalledOnce()
    })
})
