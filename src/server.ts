import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import logger from "./logger.js";
import { webhookQueue } from "./queue.js";

const app = new Hono()

// Endpoint healthceck
app.get("/health", (c) => c.json({ status: "ok" }))

app.post('/webhook/xendit', async (c) => {
    // parse body
    const body: unknown = await c.req.json()

    // generate unique id
    const id = randomUUID()

    // log incoming data
    try {
        await webhookQueue.add("incoming", {
            id,
            receivedAt: new Date().toISOString(),
            headers: Object.fromEntries(c.req.raw.headers),
            body
        })

        logger.info({ webhookId: id }, "Webhook enqueued")
        return c.json({ status: "ok", id }, 200)
    } catch (err) {
        logger.error({ err, webhookId: id }, "Failed to enqueue")
        return c.json({ status: "error" }, 500)
    }

})

export default app