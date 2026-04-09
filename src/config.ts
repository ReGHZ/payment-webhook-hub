import 'dotenv/config' 
import { watch } from "chokidar";
import { readFileSync } from "node:fs";
import path from "node:path";
import logger from "./logger.js";
import type { Target } from './types.js'

const filePath = process.env.TARGETS_FILE_PATH ?? './targets.json'

// resolve path
const resolvedPath = path.resolve(filePath)

let currentTargets: Target[] =[]

// load config
function loadTargets(): void {
  try {
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw) as { targets?: Target[] }

    if (!parsed.targets || !Array.isArray(parsed.targets)) {
      throw new Error('Invalid targets format')
    }

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

// initial load
loadTargets()

// watch file changes (hot reload)
const watcher = watch(resolvedPath, {
  ignoreInitial: true
})

watcher.on('change', () => {
  logger.info('targets.json changed, reloading...')
  loadTargets()
})

// public getter (ONLY enabled targets)
export function getTargets(): Target[] {
  return currentTargets.filter((t) => t.enabled)
}