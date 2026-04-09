import "dotenv/config"
import { Worker } from "bullmq"
import { Redis } from "ioredis"
import { getTargets } from "./config.js"
import { redisConfig } from "./queue.js"
import logger from "./logger.js"
import type { Target, WebhookJobData } from "./types.js"

// forwarder
async function forwardToTarget(
    target: Target,
    data: WebhookJobData
): Promise<void> {
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
            body: JSON.stringify(data.body),
            signal: controller.signal
        })

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`)
        }

        logger.info(
            { webhookId: data.id, target: target.name },
            "Forward success"
        )
    } catch (err) {
        logger.error(
            { webhookId: data.id, target: target.name, err },
            "Forward failed"
        )

        throw err // BullMQ retry
    } finally {
        clearTimeout(timeout)
    }
}

// Worker
const worker = new Worker(
    "xendit-webhook",
    async (job) => {
        const data = job.data as WebhookJobData

        logger.info(
            { webhookId: data.id },
            "Processing webhook job"
        )

        const targets = getTargets()

        // parallel execution
        await Promise.all(
            targets.map((target) => forwardToTarget(target, data))
        )

        logger.info(
            { webhookId: data.id },
            "All targets processed"
        )
    },
    {
        connection: new Redis(redisConfig),
        prefix: "webhook-bridge",
        concurrency: 10
    }
)

// lifecycle logging
worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Job completed")
})

worker.on("failed", (job, err) => {
    logger.error(
        { jobId: job?.id, err },
        "Job failed"
    )
})