import { dispatcherWorker } from "./dispatcher.js"
import { forwarderWorker } from "./forwarder.js"
import { closeAll } from "./queue.js"
import { closeConfigWatcher } from "./config.js"
import { closeProviderWatcher } from "./providers.js"
import logger from "./logger.js"

logger.info("Workers started")

async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down workers...")

    const forceTimeout = setTimeout(() => {
        logger.error("Force shutdown after timeout")
        process.exit(1)
    }, 10000)

    try {
        await Promise.all([
            dispatcherWorker.close(),
            forwarderWorker.close(),
        ])
        await Promise.all([
            closeAll(),
            closeConfigWatcher(),
            closeProviderWatcher(),
        ])
        logger.info("All workers and resources closed gracefully")
    } catch (err) {
        logger.error({ err }, "Error during worker shutdown")
    } finally {
        clearTimeout(forceTimeout)
        process.exit(0)
    }
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
