import "dotenv/config"
import { Worker } from "bullmq"
import { getTargets } from "./config.js"
import { createWorkerConnection, forwardQueue } from "./queue.js"
import logger from "./logger.js"
import { XenditWebhookBodySchema } from "./schemas.js"
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

        const parsed = XenditWebhookBodySchema.safeParse(data.body)

        if (!parsed.success) {
            logger.warn(
                { webhookId: data.id, errors: parsed.error.flatten() },
                "Invalid webhook body: missing or invalid external_id"
            )
            return
        }

        const externalId = parsed.data.external_id

        // sort desc biar prefix paling spesifik menang
        const matchedTarget = targets
            .sort((a, b) => b.prefix.length - a.prefix.length)
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
        connection: createWorkerConnection("dispatcher"),
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