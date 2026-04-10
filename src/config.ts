import 'dotenv/config'
import { watch } from "chokidar";
import { readFileSync } from "node:fs";
import path from "node:path";
import logger from "./logger.js";
import { TargetsFileSchema } from "./schemas.js";
import type { Target } from './types.js'

const filePath = process.env.TARGETS_FILE_PATH ?? './targets.json'

const resolvedPath = path.resolve(filePath)

let currentTargets: Target[] = []

function loadTargets(): void {
  try {
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = TargetsFileSchema.parse(JSON.parse(raw) as unknown)

    currentTargets = parsed.targets

    logger.info(
      { count: currentTargets.length },
      'Targets loaded successfully'
    )
  } catch (err) {
    logger.error(
      { err, path: resolvedPath },
      'Failed to load targets.json, using previous config'
    )
  }
}

loadTargets()

// auto-reload kalau file berubah
const watcher = watch(resolvedPath, {
  ignoreInitial: true
})

watcher.on('change', () => {
  logger.info('targets.json changed, reloading...')
  loadTargets()
})

export function getTargets(): Target[] {
  return currentTargets.filter((t) => t.enabled)
}