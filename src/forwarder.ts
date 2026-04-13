import "dotenv/config"
import { Worker } from "bullmq"
import { createWorkerConnection, dlq } from "./queue.js"
import logger from "./logger.js"
import type { ForwardJobData } from "./types.js"

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const ENV_LABEL = (process.env.NODE_ENV ?? "development").toUpperCase()

async function notifyDLQ(data: ForwardJobData, reason: string): Promise<void> {
    if (DISCORD_WEBHOOK_URL == null || DISCORD_WEBHOOK_URL === "") return

    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: `[${ENV_LABEL}] Webhook DLQ Alert`,
                    color: ENV_LABEL === "PRODUCTION" ? 0xff0000 : 0xffaa00,
                    fields: [
                        { name: "Webhook ID", value: data.webhook.id, inline: true },
                        { name: "Target", value: data.target.name, inline: true },
                        { name: "Error", value: reason.slice(0, 1024) },
                        { name: "External ID", value: typeof (data.webhook.body as Record<string, unknown>)?.external_id === "string" ? (data.webhook.body as Record<string, unknown>).external_id as string : "-", inline: true },
                    ],
                    timestamp: new Date().toISOString(),
                }]
            })
        })
    } catch (err) {
        logger.error({ err }, "Failed to send Discord DLQ alert")
    }
}

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
        void notifyDLQ(data, err.message)
        logger.error(
            { jobId: job.id, webhookId: data.webhook.id, target: data.target.name },
            "Job moved to DLQ after max retries"
        )
    } else {
        logger.error({ jobId: job.id, err }, "Forward job failed, will retry")
    }
})