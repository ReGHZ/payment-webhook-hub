export interface Target {
    name: string
    url: string
    enabled: boolean
    prefix: string
    headers?: Record<string, string>
    timeoutMs?: number
}

export interface WebhookJobData {
    id: string
    receivedAt: string
    headers: Record<string, string>
    body: unknown
}

export interface ForwardJobData {
    webhook: WebhookJobData
    target: Target
    dispatchedAt: string
}