import 'dotenv/config'
import { watch } from "chokidar";
import { readFileSync } from "node:fs";
import path from "node:path";
import logger from "./logger.js";
import { TargetsFileSchema } from "./schemas.js";
import type { Target } from './types.js'

const filePath = process.env.TARGETS_FILE_PATH ?? './config/targets.json'

const resolvedPath = path.resolve(filePath)

let currentTargets: Target[] = []

function loadTargets(initial = false): void {
  try {
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = TargetsFileSchema.parse(JSON.parse(raw) as unknown)

    currentTargets = parsed.targets

    logger.info(
      { count: currentTargets.length },
      'Targets loaded successfully'
    )
  } catch (err) {
    if (initial) {
      throw new Error(`Failed to load targets.json on startup: ${String(err)}`)
    }
    logger.error(
      { err, path: resolvedPath },
      'Failed to load targets.json, using previous config'
    )
  }
}

loadTargets(true)

// auto-reload kalau file berubah; awaitWriteFinish cegah baca partial-write
const watcher = watch(resolvedPath, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 50
  }
})

watcher.on('change', () => {
  logger.info('targets.json changed, reloading...')
  loadTargets()
})

export function getTargets(): Target[] {
  return currentTargets.filter((t) => t.enabled)
}

export function getAllTargets(): Target[] {
  return currentTargets
}

export async function closeConfigWatcher(): Promise<void> {
  await watcher.close()
}