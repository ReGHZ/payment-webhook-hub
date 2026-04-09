export interface Target {
    name: string
    url: string
    enabled: boolean
    headers?: Record<string,string>
    timeoutMs?: number
}

export interface WebhookJobData {
    id: string
    receivedAt: string
    headers: Record<string,string>
    body:unknown
}