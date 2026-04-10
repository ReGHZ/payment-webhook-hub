import "dotenv/config"
import { Worker } from "bullmq"
import { createWorkerConnection, dlq } from "./queue.js"
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

        throw err // biar bullmq retry
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
        connection: createWorkerConnection("forwarder"),
        prefix: "webhook-bridge",
        concurrency: 10
    }
)

forwarderWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Forward job completed")
})

forwarderWorker.on("failed", (job, err) => {
    if (!job) return

    const maxAttempts = job.opts.attempts ?? 5
    if (job.attemptsMade >= maxAttempts) {
        const data = job.data as ForwardJobData
        void dlq.add("dead", {
            ...data,
            failedReason: err.message,
            failedAt: new Date().toISOString(),
        })
        logger.error(
            { jobId: job.id, webhookId: data.webhook.id, target: data.target.name },
            "Job moved to DLQ after max retries"
        )
    } else {
        logger.error({ jobId: job.id, err }, "Forward job failed, will retry")
    }
})