/**
 * Unit tests untuk Zod schemas (src/schemas.ts)
 *
 * Schema ini dipakai untuk validasi data di 2 tempat:
 * - targets.json (config file yang menentukan kemana webhook diteruskan)
 * - Webhook body dari Xendit
 *
 * Test ini memastikan schema menerima data yang valid dan menolak yang tidak valid.
 * Ini penting karena config di-load dari file JSON external (targets.json)
 * yang bisa saja diedit manual dan berisi typo atau format salah.
 *
 * TargetSchema — validasi satu target entry:
 *   - required: name, url (harus valid URL), enabled, prefix
 *   - optional: headers (key-value string), timeoutMs (harus positif)
 *
 * TargetsFileSchema — validasi struktur file targets.json:
 *   - Harus punya field "targets" berisi array of TargetSchema
 */

import { describe, it, expect } from "vitest"
import { TargetsFileSchema, TargetSchema } from "../schemas.js"

describe("TargetSchema", () => {
    it("terima target dengan field required lengkap", () => {
        const result = TargetSchema.safeParse({
            name: "test",
            url: "https://example.com/webhook",
            enabled: true,
            prefix: "TEST-",
        })
        expect(result.success).toBe(true)
    })

    it("terima target dengan optional fields (headers, timeoutMs)", () => {
        const result = TargetSchema.safeParse({
            name: "test",
            url: "https://example.com/webhook",
            enabled: true,
            prefix: "TEST-",
            headers: { Authorization: "Bearer abc" },
            timeoutMs: 10000,
        })
        expect(result.success).toBe(true)
    })

    it("tolak target dengan URL tidak valid — mencegah forward ke URL sampah", () => {
        const result = TargetSchema.safeParse({
            name: "test",
            url: "not-a-url",
            enabled: true,
            prefix: "TEST-",
        })
        expect(result.success).toBe(false)
    })

    it("tolak target tanpa name — setiap target harus punya identifier", () => {
        const result = TargetSchema.safeParse({
            url: "https://example.com/webhook",
            enabled: true,
            prefix: "TEST-",
        })
        expect(result.success).toBe(false)
    })

    it("tolak target dengan timeoutMs negatif — timeout harus bernilai positif", () => {
        const result = TargetSchema.safeParse({
            name: "test",
            url: "https://example.com/webhook",
            enabled: true,
            prefix: "TEST-",
            timeoutMs: -1,
        })
        expect(result.success).toBe(false)
    })
})

describe("TargetsFileSchema", () => {
    it("terima file targets.json dengan struktur yang benar", () => {
        const result = TargetsFileSchema.safeParse({
            targets: [
                {
                    name: "cafe",
                    url: "https://example.com/cafe",
                    enabled: true,
                    prefix: "CAFE-",
                },
                {
                    name: "gym",
                    url: "https://example.com/gym",
                    enabled: false,
                    prefix: "GYM-",
                },
            ],
        })
        expect(result.success).toBe(true)
    })

    it("tolak JSON tanpa field targets — file config harus punya array targets", () => {
        const result = TargetsFileSchema.safeParse({})
        expect(result.success).toBe(false)
    })

    it("tolak jika ada entry target yang tidak valid di dalam array", () => {
        const result = TargetsFileSchema.safeParse({
            targets: [{ name: "bad" }], // missing url, enabled, prefix
        })
        expect(result.success).toBe(false)
    })
})
