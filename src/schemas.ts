import { z } from "zod"

export const XenditWebhookBodySchema = z.looseObject({
    id: z.string().optional(),
    external_id: z.string(),
})

export const TargetSchema = z.object({
    name: z.string(),
    url: z.url(),
    enabled: z.boolean(),
    prefix: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().positive().optional(),
})

export const TargetsFileSchema = z.object({
    targets: z.array(TargetSchema),
})

export const WebhookJobDataSchema = z.object({
    id: z.string(),
    receivedAt: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
})

export const ForwardJobDataSchema = z.object({
    webhook: WebhookJobDataSchema,
    target: TargetSchema,
    dispatchedAt: z.string(),
})
