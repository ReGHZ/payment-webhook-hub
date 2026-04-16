import { z } from "zod"

// provider verification
export const ProviderVerifySchema = z.discriminatedUnion("method", [
    z.object({ method: z.literal("header-token"), headerName: z.string(), envKey: z.string() }),
    z.object({ method: z.literal("hmac-sha256"), headerName: z.string(), envKey: z.string() }),
    z.object({ method: z.literal("hmac-sha512"), headerName: z.string(), envKey: z.string() }),
    z.object({ method: z.literal("stripe-signature"), headerName: z.string(), envKey: z.string() }),
    z.object({ method: z.literal("none") }),
])

export const ProviderConfigSchema = z.object({
    name: z.string(),
    enabled: z.boolean(),
    routingField: z.string(),
    dedupField: z.string().optional(),
    verify: ProviderVerifySchema,
})

export const ProvidersFileSchema = z.object({
    providers: z.array(ProviderConfigSchema),
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
    provider: z.string(),
    receivedAt: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
})

export const ForwardJobDataSchema = z.object({
    webhook: WebhookJobDataSchema,
    target: TargetSchema,
    dispatchedAt: z.string(),
})
