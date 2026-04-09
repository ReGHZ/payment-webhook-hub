import "dotenv/config"
import { Worker } from "bullmq"
import { Redis } from "ioredis"
import { redisConfig } from "./queue.js"
import logger from "./logger.js"
import type { ForwardJobData } from "./types.js"

async function forwardToTarget(data: ForwardJobData): Promise<void> {
    const { webhook, target } = data

    const controller = new AbortController()

    const timeout = setTimeout(() => {
        controller.abort()
    }, target.timeoutMs ?? 5000)

    try {
        const res = await fetch(target.url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...target.headers
            },
            body: JSON.stringify(webhook.body),
            signal: controller.signal
        })

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`)
        }

        logger.info(
            { webhookId: webhook.id, target: target.name },
            "Forward success"
        )
    } catch (err) {
        logger.error(
            { webhookId: webhook.id, target: target.name, err },
            "Forward failed"
        )

        throw err // retry per target
    } finally {
        clearTimeout(timeout)
    }
}

export const forwarderWorker = new Worker(
    "forward",
    async (job) => {
        const data = job.data as ForwardJobData

        await forwardToTarget(data)
    },
    {
        connection: new Redis(redisConfig),
        prefix: "webhook-bridge",
        concurrency: 10
    }
)

forwarderWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Forward job completed")
})

forwarderWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Forward job failed")
})