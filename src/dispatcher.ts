import "dotenv/config"
import { Worker } from "bullmq"
import { Redis } from "ioredis"
import { getTargets } from "./config.js"
import { redisConfig, forwardQueue } from "./queue.js"
import logger from "./logger.js"
import type { WebhookJobData, ForwardJobData } from "./types.js"

export const dispatcherWorker = new Worker(
    "xendit-webhook",
    async (job) => {
        const data = job.data as WebhookJobData

        logger.info(
            { webhookId: data.id },
            "Dispatching webhook"
        )

        const targets = getTargets()

        const body = data.body

        // type-safe narrowing
        if (
            typeof body !== "object" ||
            body === null ||
            !("external_id" in body) ||
            typeof body.external_id !== "string"
        ) {
            logger.warn(
                { webhookId: data.id },
                "Invalid webhook body: missing external_id"
            )
            return
        }

        const externalId = body.external_id

        // routing by prefix
        const matchedTarget = targets
            .sort((a, b) => b.prefix.length - a.prefix.length) // biar prefix paling spesifik menang
            .find(t => externalId.startsWith(t.prefix))

        if (!matchedTarget) {
            logger.warn(
                { webhookId: data.id, externalId },
                "No matching target"
            )
            return
        }

        const forwardJob: ForwardJobData = {
            webhook: data,
            target: matchedTarget,
            dispatchedAt: new Date().toISOString()
        }

        await forwardQueue.add("forward", forwardJob)

        logger.info(
            { webhookId: data.id, target: matchedTarget.name },
            "Dispatched to matched target"
        )
    },
    {
        connection: new Redis(redisConfig),
        prefix: "webhook-bridge",
        concurrency: 10
    }
)

dispatcherWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Dispatch job completed")
})

dispatcherWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Dispatch job failed")
})