/**
 * Integration tests untuk config-writer (src/config-writer.ts).
 *
 * Fokus verifikasi:
 * 1. writeAtomic pattern sukses di filesystem biasa (dev local non-Docker)
 * 2. Schema validasi reject payload invalid — file tidak ter-overwrite
 * 3. Round-trip write → read → parse match schema
 *
 * Menggunakan env var override (TARGETS_FILE_PATH, PROVIDERS_FILE_PATH) yang
 * di-set SEBELUM import — wajib karena config-writer.ts resolve path saat module
 * load. Dinamis pakai vi.resetModules() biar tiap test isi path beda.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

describe("config-writer", () => {
    let tmpDir: string
    let targetsPath: string
    let providersPath: string

    beforeEach(() => {
        tmpDir = mkdtempSync(path.join(tmpdir(), "webhook-hub-test-"))
        targetsPath = path.join(tmpDir, "targets.json")
        providersPath = path.join(tmpDir, "providers.json")
        process.env.TARGETS_FILE_PATH = targetsPath
        process.env.PROVIDERS_FILE_PATH = providersPath
        vi.resetModules()
    })

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true })
        delete process.env.TARGETS_FILE_PATH
        delete process.env.PROVIDERS_FILE_PATH
    })

    describe("writeTargets", () => {
        it("tulis targets valid ke disk dengan JSON format terindentasi", async () => {
            const { writeTargets } = await import("../config-writer.js")
            const targets = [
                {
                    name: "service-a",
                    url: "https://example.com/webhook",
                    enabled: true,
                    prefix: "SVC-A-",
                },
            ]

            await writeTargets(targets)

            const raw = readFileSync(targetsPath, "utf-8")
            expect(raw.endsWith("\n")).toBe(true)
            const parsed = JSON.parse(raw) as { targets: typeof targets }
            expect(parsed.targets).toEqual(targets)
        })

        it("reject targets invalid (URL tidak valid) — file lama tidak berubah", async () => {
            const originalContent = JSON.stringify({ targets: [] }, null, 2) + "\n"
            writeFileSync(targetsPath, originalContent, "utf-8")

            const { writeTargets } = await import("../config-writer.js")
            await expect(
                writeTargets([
                    {
                        name: "bad",
                        url: "not-a-url",
                        enabled: true,
                        prefix: "BAD-",
                    },
                ]),
            ).rejects.toThrow()

            expect(readFileSync(targetsPath, "utf-8")).toBe(originalContent)
        })

        it("round-trip: write → file readable → content match input", async () => {
            const { writeTargets } = await import("../config-writer.js")
            const targets = [
                {
                    name: "svc",
                    url: "https://api.example.com/cb",
                    enabled: true,
                    prefix: "SVC-",
                    headers: { Authorization: "Bearer xyz" },
                    timeoutMs: 15000,
                },
            ]

            await writeTargets(targets)

            const raw = readFileSync(targetsPath, "utf-8")
            const parsed = JSON.parse(raw) as { targets: typeof targets }
            expect(parsed.targets[0]).toEqual(targets[0])
        })
    })

    describe("writeProviders", () => {
        it("tulis providers valid ke disk", async () => {
            const { writeProviders } = await import("../config-writer.js")
            const providers = [
                {
                    name: "xendit",
                    enabled: true,
                    routingField: "external_id",
                    verify: { method: "none" as const },
                },
            ]

            await writeProviders(providers)

            const raw = readFileSync(providersPath, "utf-8")
            const parsed = JSON.parse(raw) as { providers: typeof providers }
            expect(parsed.providers).toEqual(providers)
        })

        it("reject providers invalid (missing verify) — throw error", async () => {
            const { writeProviders } = await import("../config-writer.js")

            await expect(
                writeProviders([
                    {
                        name: "bad",
                        enabled: true,
                        routingField: "id",
                    } as unknown as Parameters<typeof writeProviders>[0][number],
                ]),
            ).rejects.toThrow()
        })
    })
})
