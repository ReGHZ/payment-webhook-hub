/**
 * Unit tests untuk Dispatcher Worker (src/dispatcher.ts)
 *
 * Dispatcher bertugas menerima webhook dari queue "xendit-webhook",
 * lalu mencocokkan external_id dengan prefix target di targets.json.
 * Jika cocok, webhook diteruskan ke queue "forward".
 *
 * Test ini memverifikasi logika routing:
 *
 * 1. Validasi body — webhook tanpa external_id atau tipe salah harus di-skip
 * 2. Prefix matching — external_id dicocokkan dengan prefix target
 * 3. Specificity — jika ada 2 prefix yang cocok, yang lebih spesifik (panjang) menang
 *    Contoh: "WULF-CAFE-001" cocok dengan "WULF-" dan "WULF-CAFE-",
 *    tapi yang dipilih adalah "WULF-CAFE-" karena lebih spesifik
 * 4. No match — jika tidak ada target yang cocok, webhook di-skip (tidak error)
 *
 * Cara kerja mock:
 * - BullMQ Worker di-mock dengan class palsu yang menangkap processor function
 * - Processor function tersebut dipanggil langsung di test dengan job data buatan
 * - forwardQueue.add di-mock untuk verifikasi apakah job diteruskan atau tidak
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../queue.js", () => ({
    redisConfig: {},
    forwardQueue: {
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

vi.mock("../logger.js", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

/**
 * Mock BullMQ Worker sebagai class palsu.
 * Ketika dispatcher.ts membuat `new Worker(name, processor, opts)`,
 * kita tangkap `processor` function supaya bisa dipanggil langsung di test.
 */
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

// Import dispatcher untuk trigger constructor Worker dan capture processor
await import("../dispatcher.js")

/** Helper: buat fake BullMQ job dengan body webhook */
function makeJob(body: unknown, id = "test-webhook-1") {
    return {
        data: {
            id,
            receivedAt: new Date().toISOString(),
            headers: {},
            body,
        },
    }
}

describe("dispatcher worker", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("skip webhook yang tidak punya external_id — tidak boleh masuk forward queue", async () => {
        const job = makeJob({ amount: 5000 })
        await capturedProcessor!(job)
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("skip webhook yang external_id bukan string (misal number) — Zod validation gagal", async () => {
        const job = makeJob({ external_id: 123 })
        await capturedProcessor!(job)
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("skip webhook yang external_id tidak cocok dengan prefix target manapun", async () => {
        vi.mocked(getTargets).mockReturnValue([
            { name: "cafe", url: "http://localhost", enabled: true, prefix: "CAFE-" },
        ])
        const job = makeJob({ external_id: "GYM-001" })
        await capturedProcessor!(job)
        expect(forwardQueue.add).not.toHaveBeenCalled()
    })

    it("forward webhook ke target yang prefix-nya cocok dengan external_id", async () => {
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
        // "WULF-CAFE-001" cocok dengan "WULF-" dan "WULF-CAFE-"
        // Yang dipilih harus "WULF-CAFE-" karena lebih spesifik
        vi.mocked(getTargets).mockReturnValue([
            { name: "wulf", url: "http://localhost/wulf", enabled: true, prefix: "WULF-" },
            { name: "wulf-cafe", url: "http://localhost/cafe", enabled: true, prefix: "WULF-CAFE-" },
        ])
        const job = makeJob({ external_id: "WULF-CAFE-001" })
        await capturedProcessor!(job)

        const call = vi.mocked(forwardQueue.add).mock.calls[0]!
        expect((call[1] as { target: { name: string } }).target.name).toBe("wulf-cafe")
    })
})
