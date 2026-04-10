import { dispatcherWorker } from "./dispatcher.js"
import { forwarderWorker } from "./forwarder.js"
import logger from "./logger.js"

logger.info("Workers started")

async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down workers...")

    setTimeout(() => {
        logger.error("Force shutdown after timeout")
        process.exit(1)
    }, 10000)

    await Promise.all([
        dispatcherWorker.close(),
        forwarderWorker.close()
    ])

    logger.info("All workers closed gracefully")
    process.exit(0)
}

process.on("SIGINT", () => {
    void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
    void shutdown("SIGTERM")
})