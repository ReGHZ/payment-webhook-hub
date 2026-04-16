import "dotenv/config"
import { serve } from "@hono/node-server"
import app from "./server.js"
import logger from "./logger.js"
import { closeAll } from "./queue.js"
import { closeConfigWatcher } from "./config.js"
import { closeProviderWatcher } from "./providers.js"

const port = Number(process.env.PORT ?? 3005)

const server = serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    logger.info(`server running on http://localhost:${info.port}`)
  }
)

function shutdown(signal: string) {
  logger.info(`received ${signal}, shutting down...`)

  const forceTimeout = setTimeout(() => {
    logger.error("forced shutdown, timeout exceeded")
    process.exit(1)
  }, 10000)

  server.close(() => {
    void (async () => {
      try {
        await Promise.all([
          closeAll(),
          closeConfigWatcher(),
          closeProviderWatcher(),
        ])
        logger.info("all resources closed")
      } catch (err) {
        logger.error({ err }, "error during cleanup")
      } finally {
        clearTimeout(forceTimeout)
        process.exit(0)
      }
    })()
  })
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
