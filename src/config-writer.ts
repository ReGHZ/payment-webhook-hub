import { writeFile, rename } from "node:fs/promises"
import path from "node:path"
import { TargetsFileSchema, ProvidersFileSchema } from "./schemas.js"
import type { Target, ProviderConfig } from "./types.js"

const targetsPath = path.resolve(process.env.TARGETS_FILE_PATH ?? "./config/targets.json")
const providersPath = path.resolve(process.env.PROVIDERS_FILE_PATH ?? "./config/providers.json")

// tulis ke .tmp dulu, baru rename — rename atomic di same filesystem
async function writeAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp`
    await writeFile(tmp, content, "utf-8")
    await rename(tmp, filePath)
}

export async function writeTargets(targets: Target[]): Promise<void> {
    // validasi dulu, kalau gagal throw
    const validated = TargetsFileSchema.parse({ targets })
    await writeAtomic(targetsPath, JSON.stringify(validated, null, 2) + "\n")
}

export async function writeProviders(providers: ProviderConfig[]): Promise<void> {
    const validated = ProvidersFileSchema.parse({ providers })
    await writeAtomic(providersPath, JSON.stringify(validated, null, 2) + "\n")
}
