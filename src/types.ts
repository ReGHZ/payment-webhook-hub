import type { z } from "zod"
import type {
    TargetSchema,
    WebhookJobDataSchema,
    ForwardJobDataSchema,
    ProviderConfigSchema,
    ProviderVerifySchema,
    ProvidersFileSchema,
} from "./schemas.js"

export type Target = z.infer<typeof TargetSchema>
export type WebhookJobData = z.infer<typeof WebhookJobDataSchema>
export type ForwardJobData = z.infer<typeof ForwardJobDataSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderVerify = z.infer<typeof ProviderVerifySchema>
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>
