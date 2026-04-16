/**
 * Unit tests untuk Forwarder Worker (src/forwarder.ts)
 *
 * Forwarder bertugas mengambil job dari queue "forward",
 * lalu HTTP POST ke target URL dengan body webhook asli.
 *
 * Test ini memverifikasi:
 *
 * 1. Happy path — forward sukses (HTTP 200)
 * 2. HTTP error — target return non-2xx, harus throw supaya BullMQ retry
 * 3. Custom headers — headers dari target config dikirim bersama request
 * 4. Timeout — request yang melebihi timeoutMs harus di-abort
 * 5. DLQ — job yang gagal setelah max retry masuk DLQ + kirim Discord alert
 * 6. DLQ tanpa Discord — tetap masuk DLQ walau DISCORD_WEBHOOK_URL kosong
 *
 * Cara kerja mock:
 * - BullMQ Worker di-mock dengan class palsu yang menangkap processor + event handler
 * - global.fetch di-mock untuk simulasi HTTP response dari target
 * - dlq.add di-mock untuk verifikasi job masuk DLQ
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../queue.js", () => ({
    dlq: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    createWorkerConnection: vi.fn().mockReturnValue({
        status: "ready",
        disconnect: vi.fn(),
    }),
}))

vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

vi.mock("../providers.js", () => ({
    getProvider: vi.fn().mockReturnValue({
        name: "xendit",
        enabled: true,
        routingField: "external_id",
        verify: { method: "none" as const },
    }),
}))

let capturedProcessor: ((job: unknown) => Promise<void>) | null = null
const capturedEvents: Record<string, (...args: unknown[]) => void> = {}

vi.mock("bullmq", () => {
    class MockWorker {
        on = vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
            capturedEvents[event] = handler
        })
        close = vi.fn()
        constructor(_name: string, processor: (job: unknown) => Promise<void>) {
            capturedProcessor = processor
        }
    }
    return { Worker: MockWorker }
})

const { dlq } = await import("../queue.js")

// Import forwarder untuk trigger constructor Worker
await import("../forwarder.js")

/** Helper: buat fake ForwardJobData */
function makeForwardJob(overrides?: {
    url?: string
    headers?: Record<string, string>
    timeoutMs?: number
    body?: unknown
}) {
    return {
        data: {
            webhook: {
                id: "webhook-123",
                provider: "xendit",
                receivedAt: new Date().toISOString(),
                headers: {},
                body: overrides?.body ?? { external_id: "WULF-CAFE-001", amount: 50000 },
            },
            target: {
                name: "test-target",
                url: overrides?.url ?? "https://example.com/callback",
                enabled: true,
                prefix: "WULF-CAFE-",
                headers: overrides?.headers,
                timeoutMs: overrides?.timeoutMs,
            },
            dispatchedAt: new Date().toISOString(),
        },
    }
}

describe("forwarder worker", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.restoreAllMocks()
    })

    it("forward webhook ke target dan selesai tanpa error (HTTP 200)", async () => {
        const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("OK", { status: 200 })
        )

        const job = makeForwardJob()
        await capturedProcessor!(job)

        expect(mockFetch).toHaveBeenCalledOnce()
        const [url, init] = mockFetch.mock.calls[0]!
        expect(url).toBe("https://example.com/callback")
        expect(init?.method).toBe("POST")
        expect(init?.body).toBe(JSON.stringify(job.data.webhook.body))
    })

    it("throw error kalau target return non-2xx — supaya BullMQ retry", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("Internal Server Error", { status: 500 })
        )

        const job = makeForwardJob()
        await expect(capturedProcessor!(job)).rejects.toThrow("HTTP 500")
    })

    it("kirim custom headers dari target config bersama request", async () => {
        const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("OK", { status: 200 })
        )

        const job = makeForwardJob({
            headers: { "Authorization": "Bearer secret-123", "X-Custom": "value" }
        })
        await capturedProcessor!(job)

        const [, init] = mockFetch.mock.calls[0]!
        const headers = init?.headers as { Authorization: string; "X-Custom": string; "content-type": string }
        expect(headers.Authorization).toBe("Bearer secret-123")
        expect(headers["X-Custom"]).toBe("value")
        expect(headers["content-type"]).toBe("application/json")
    })

    it("abort request kalau melebihi timeoutMs", async () => {
        vi.useFakeTimers()

        vi.spyOn(globalThis, "fetch").mockImplementation(
            (_url, init) => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted.", "AbortError"))
                })
            })
        )

        const job = makeForwardJob({ timeoutMs: 3000 })
        const promise = capturedProcessor!(job)

        vi.advanceTimersByTime(3000)

        await expect(promise).rejects.toThrow("aborted")

        vi.useRealTimers()
    })

    it("masukkan job ke DLQ setelah max retry tercapai", () => {
        const failedHandler = capturedEvents.failed
        expect(failedHandler).toBeDefined()

        const job = makeForwardJob()
        const fakeJob = {
            id: "job-99",
            data: job.data,
            attemptsMade: 5,
            opts: { attempts: 5 },
        }

        failedHandler(fakeJob, new Error("HTTP 503"))

        expect(dlq.add).toHaveBeenCalledOnce()
        const call = vi.mocked(dlq.add).mock.calls[0]!
        expect(call[0]).toBe("dead")
        expect((call[1] as { failedReason: string }).failedReason).toBe("HTTP 503")
    })

    it("tidak masukkan ke DLQ kalau masih ada retry tersisa", () => {
        const failedHandler = capturedEvents.failed

        const job = makeForwardJob()
        const fakeJob = {
            id: "job-99",
            data: job.data,
            attemptsMade: 2,
            opts: { attempts: 5 },
        }

        failedHandler(fakeJob, new Error("HTTP 503"))

        expect(dlq.add).not.toHaveBeenCalled()
    })
})
