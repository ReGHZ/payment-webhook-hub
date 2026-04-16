import "dotenv/config"
import { Worker } from "bullmq"
import { getTargets } from "./config.js"
import { createWorkerConnection, forwardQueue, dlq } from "./queue.js"
import logger from "./logger.js"
import { getProvider } from "./providers.js"
import { getNestedField } from "./utils.js"
import type { WebhookJobData, ForwardJobData } from "./types.js"

export const dispatcherWorker = new Worker(
    "webhook-incoming",
    async (job) => {
        const data = job.data as WebhookJobData

        logger.info(
            { webhookId: data.id, provider: data.provider },
            "Dispatching webhook",
        )

        const provider = getProvider(data.provider)
        if (!provider) {
            throw new Error(`Unknown provider: ${data.provider}`)
        }

        const routingValue = getNestedField(data.body, provider.routingField)
        if (typeof routingValue !== "string") {
            throw new Error(`Missing or invalid routing field '${provider.routingField}' for provider '${data.provider}'`)
        }

        const targets = getTargets()

        // sort desc biar prefix paling spesifik menang
        const matchedTarget = targets
            .sort((a, b) => b.prefix.length - a.prefix.length)
            .find((t) => routingValue.startsWith(t.prefix))

        if (!matchedTarget) {
            throw new Error(`No matching target for routing value: ${routingValue}`)
        }

        const forwardJob: ForwardJobData = {
            webhook: data,
            target: matchedTarget,
            dispatchedAt: new Date().toISOString(),
        }

        await forwardQueue.add("forward", forwardJob)

        logger.info(
            { webhookId: data.id, target: matchedTarget.name },
            "Dispatched to matched target",
        )
    },
    {
        connection: createWorkerConnection("dispatcher"),
        prefix: "webhook-bridge",
        concurrency: 10,
    },
)

dispatcherWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Dispatch job completed")
})

dispatcherWorker.on("failed", (job, err) => {
    if (!job) return

    const maxAttempts = job.opts.attempts ?? 3
    if (job.attemptsMade >= maxAttempts) {
        const data = job.data as WebhookJobData
        void (async () => {
            try {
                await dlq.add("dead", {
                    ...data,
                    failedReason: err.message,
                    failedAt: new Date().toISOString(),
                })
            } catch (dlqErr) {
                logger.error({ jobId: job.id, dlqErr }, "Failed to add dispatch job to DLQ")
            }
        })()
        logger.error(
            { jobId: job.id, webhookId: data.id },
            "Dispatch job moved to DLQ after max retries",
        )
    } else {
        logger.error({ jobId: job.id, err }, "Dispatch job failed, will retry")
    }
})
