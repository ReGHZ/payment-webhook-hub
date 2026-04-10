import "dotenv/config"
import { serve } from "@hono/node-server"
import app from "./server.js"
import logger from "./logger.js"

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

  server.close(() => {
    logger.info("server closed")
    process.exit(0)
  })

  setTimeout(() => {
    logger.error("forced shutdown, timeout exceeded")
    process.exit(1)
  }, 10000)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))