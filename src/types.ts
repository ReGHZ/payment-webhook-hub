import type { z } from "zod"
import type {
    TargetSchema,
    WebhookJobDataSchema,
    ForwardJobDataSchema,
    XenditWebhookBodySchema,
} from "./schemas.js"

export type Target = z.infer<typeof TargetSchema>
export type WebhookJobData = z.infer<typeof WebhookJobDataSchema>
export type ForwardJobData = z.infer<typeof ForwardJobDataSchema>
export type XenditWebhookBody = z.infer<typeof XenditWebhookBodySchema>