import "dotenv/config"
import { watch } from "chokidar"
import { readFileSync } from "node:fs"
import path from "node:path"
import logger from "./logger.js"
import { ProvidersFileSchema } from "./schemas.js"
import type { ProviderConfig } from "./types.js"

const filePath = process.env.PROVIDERS_FILE_PATH ?? "./providers.json"
const resolvedPath = path.resolve(filePath)

let currentProviders: ProviderConfig[] = []

function loadProviders(initial = false): void {
    try {
        const raw = readFileSync(resolvedPath, "utf-8")
        const parsed = ProvidersFileSchema.parse(JSON.parse(raw) as unknown)

        currentProviders = parsed.providers

        logger.info(
            { count: currentProviders.length },
            "Providers loaded successfully",
        )
    } catch (err) {
        if (initial) {
            throw new Error(`Failed to load providers.json on startup: ${String(err)}`)
        }
        logger.error(
            { err, path: resolvedPath },
            "Failed to load providers.json, using previous config",
        )
    }
}

loadProviders(true)

const watcher = watch(resolvedPath, { ignoreInitial: true })
watcher.on("change", () => {
    logger.info("providers.json changed, reloading...")
    loadProviders()
})

export function getProvider(name: string): ProviderConfig | undefined {
    return currentProviders.find((p) => p.enabled && p.name === name)
}

export function getProviders(): ProviderConfig[] {
    return currentProviders.filter((p) => p.enabled)
}

export async function closeProviderWatcher(): Promise<void> {
    await watcher.close()
}
