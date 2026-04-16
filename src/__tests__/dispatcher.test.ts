/**
 * Unit tests untuk Dispatcher Worker (src/dispatcher.ts)
 *
 * Dispatcher bertugas menerima webhook dari queue "webhook-incoming",
 * lalu mencocokkan routing field (configurable per provider) dengan prefix target.
 * Jika cocok, webhook diteruskan ke queue "forward".
 *
 * Test ini memverifikasi logika routing:
 *
 * 1. Unknown provider — skip jika provider tidak ditemukan di config
 * 2. Missing routing field — skip jika field yang dicari tidak ada di body
 * 3. Prefix matching — routing value dicocokkan dengan prefix target
 * 4. Specificity — jika ada 2 prefix yang cocok, yang lebih spesifik (panjang) menang
 * 5. No match — jika tidak ada target yang cocok, webhook di-skip (tidak error)
 * 6. Nested routing field — support dot-notation (e.g. "data.order_id")
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../queue.js", () => ({
    redisConfig: {},
    forwardQueue: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    dlq: {
        add: vi.fn().mockResolvedValue(undefined),
    },
    createWorkerConnection: vi.fn().mockReturnValue({
        status: "ready",
        disconnect: vi.fn(),
    }),
}))

vi.mock("../config.js", () => ({
    getTargets: vi.fn().mockReturnValue([]),
}))

vi.mock("../providers.js", () => ({
    getProvider: vi.fn(),
}))

vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

let capturedProcessor: ((job: unknown) => Promise<void>) | null = null
vi.mock("bullmq", () => {
    class MockWorker {
        on = vi.fn()
        close = vi.fn()
        constructor(_name: string, processor: (job: unknown) => Promise<void>) {
            capturedProcessor = processor
        }
    }
    return { Worker: MockWorker }
})

const { forwardQueue } = await import("../queue.js")
const { getTargets } = await import("../config.js")
const { getProvider } = await import("../providers.js")

await import("../dispatcher.js")

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

/** Helper: buat fake BullMQ job dengan body webhook */
function makeJob(body: unknown, provider = "xendit", id = "test-webhook-1") {
    return {
        data: {
            id,
            provider,
            receivedAt: new Date().toISOString(),
            headers: {},
            body,
        },
    }
}

describe("dispatcher worker", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getProvider).mockReturnValue(xenditProvider)
    })

    it("throw error untuk provider yang tidak dikenal — supaya BullMQ retry lalu DLQ", async () => {
        vi.mocked(getProvider).mockReturnValue(undefined)
        const job = makeJob({ external_id: "CAFE-001" }, "unknown")
        await expect(capturedProcessor!(job)).rejects.toThrow("Unknown provider: unknown")
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("throw error kalau routing field tidak ada di body", async () => {
        const job = makeJob({ amount: 5000 })
        await expect(capturedProcessor!(job)).rejects.toThrow("Missing or invalid routing field")
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("throw error kalau routing field bukan string", async () => {
        const job = makeJob({ external_id: 123 })
        await expect(capturedProcessor!(job)).rejects.toThrow("Missing or invalid routing field")
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("throw error kalau routing value tidak cocok dengan prefix target manapun", async () => {
        vi.mocked(getTargets).mockReturnValue([
            { name: "cafe", url: "http://localhost", enabled: true, prefix: "CAFE-" },
        ])
        const job = makeJob({ external_id: "GYM-001" })
        await expect(capturedProcessor!(job)).rejects.toThrow("No matching target")
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("forward webhook ke target yang prefix-nya cocok", async () => {
        vi.mocked(getTargets).mockReturnValue([
            { name: "cafe", url: "http://localhost/cafe", enabled: true, prefix: "CAFE-" },
        ])
        const job = makeJob({ external_id: "CAFE-001" })
        await capturedProcessor!(job)
        expect(forwardQueue.add).toHaveBeenCalledOnce()

        const call = vi.mocked(forwardQueue.add).mock.calls[0]!
        expect(call[0]).toBe("forward")
        expect((call[1] as { target: { name: string } }).target.name).toBe("cafe")
    })

    it("pilih prefix paling spesifik (panjang) jika ada multiple match", async () => {
        vi.mocked(getTargets).mockReturnValue([
            { name: "wulf", url: "http://localhost/wulf", enabled: true, prefix: "WULF-" },
            { name: "wulf-cafe", url: "http://localhost/cafe", enabled: true, prefix: "WULF-CAFE-" },
        ])
        const job = makeJob({ external_id: "WULF-CAFE-001" })
        await capturedProcessor!(job)

        const call = vi.mocked(forwardQueue.add).mock.calls[0]!
        expect((call[1] as { target: { name: string } }).target.name).toBe("wulf-cafe")
    })

    it("support nested routing field (dot-notation)", async () => {
        vi.mocked(getProvider).mockReturnValue({
            ...xenditProvider,
            routingField: "data.order_id",
        })
        vi.mocked(getTargets).mockReturnValue([
            { name: "service", url: "http://localhost/svc", enabled: true, prefix: "ORD-" },
        ])
        const job = makeJob({ data: { order_id: "ORD-999" } })
        await capturedProcessor!(job)
        expect(forwardQueue.add).toHaveBeenCalledOnce()
    })
})
