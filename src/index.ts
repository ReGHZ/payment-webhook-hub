import { serve } from "@hono/node-server"
import app from "./server.js"
import logger from "./logger.js"

const port = 3005

const server = serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    logger.info(`🚀 Server running on http://localhost:${info.port}`)
  }
)

// graceful shutdown
function shutdown(signal: string) {
  logger.info(`🛑 Received ${signal}, shutting down server...`)

  server.close(() => {
    logger.info("✅ Server closed gracefully")
    process.exit(0)
  })

  // force shutdown if to long
  setTimeout(() => {
    logger.error("❌ Force shutdown after timeout")
    process.exit(1)
  }, 10000)
}

// handle signals
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))