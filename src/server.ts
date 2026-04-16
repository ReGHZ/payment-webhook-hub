import "dotenv/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import logger from "./logger.js";
import { webhookQueue, forwardQueue, dlq, redis } from "./queue.js";
import { rateLimiter } from "./middleware/rate-limit.js";
import { adminAuth } from "./middleware/admin-auth.js";
import { getProvider } from "./providers.js";
import { verifyWebhook } from "./verify.js";
import { getNestedField } from "./utils.js";
import { ForwardJobDataSchema } from "./schemas.js";

const app = new Hono();

// Health check
app.get("/health", async (c) => {
  try {
    await redis.ping();
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "unhealthy", redis: "disconnected" }, 503);
  }
});

// Webhook ingress
app.post(
  "/webhook/:provider",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ status: "payload too large" }, 413),
  }),
  rateLimiter,
  async (c) => {
    const providerName = c.req.param("provider");
    const provider = getProvider(providerName);

    if (!provider) {
      return c.json({ status: "unknown provider" }, 404);
    }

    // raw body dulu buat HMAC, baru parse JSON
    const rawBody = await c.req.text();
    const headers = Object.fromEntries(c.req.raw.headers);

    if (!verifyWebhook(provider, headers, rawBody)) {
      logger.warn(
        { provider: providerName, ip: c.req.header("x-forwarded-for") ?? "unknown" },
        "Verification failed",
      );
      return c.json({ status: "unauthorized" }, 403);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ status: "invalid json" }, 400);
    }

    const id = randomUUID();

    // dedup 24 jam
    let dedupKey: string | null = null;
    if (provider.dedupField != null) {
      const dedupValue = getNestedField(body, provider.dedupField);
      if (typeof dedupValue === "string") {
        dedupKey = `dedup:${providerName}:${dedupValue}`;
        const isNew = await redis.set(dedupKey, "1", "EX", 86400, "NX");
        if (!isNew) {
          logger.info({ provider: providerName, dedupValue }, "Duplicate webhook, skipping");
          return c.json({ status: "ok", duplicate: true, eventId: dedupValue }, 200);
        }
      }
    }

    try {
      await webhookQueue.add("incoming", {
        id,
        provider: providerName,
        receivedAt: new Date().toISOString(),
        headers,
        body,
      });

      logger.info({ webhookId: id, provider: providerName }, "Webhook enqueued");
      return c.json({ status: "ok", id }, 200);
    } catch (err) {
      // rollback dedup biar retry gateway masuk
      if (dedupKey != null) {
        await redis.del(dedupKey);
      }
      logger.error({ err, webhookId: id }, "Failed to enqueue");
      return c.json({ status: "error" }, 500);
    }
  },
);

// Admin endpoints

app.get("/admin/dlq", adminAuth, async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  const jobs = await dlq.getJobs(
    ["waiting", "delayed", "completed", "failed"],
    0,
    limit - 1,
  );

  const result = jobs.map((job) => ({
    id: job.id,
    data: job.data as unknown,
    timestamp: job.timestamp,
  }));

  return c.json({ status: "ok", count: result.length, jobs: result });
});

app.post("/admin/dlq/:jobId/replay", adminAuth, async (c) => {
  const jobId = c.req.param("jobId");
  const job = await dlq.getJob(jobId);

  if (!job) {
    return c.json({ status: "not found" }, 404);
  }

  const parsed = ForwardJobDataSchema.safeParse({
    webhook: (job.data as Record<string, unknown>).webhook,
    target: (job.data as Record<string, unknown>).target,
    dispatchedAt: new Date().toISOString(),
  });

  if (!parsed.success) {
    return c.json({ status: "invalid job data" }, 400);
  }

  await forwardQueue.add("forward", parsed.data);

  await job.remove();

  logger.info({ jobId }, "DLQ job replayed");
  return c.json({ status: "ok", replayed: jobId });
});

app.delete("/admin/dlq/:jobId", adminAuth, async (c) => {
  const jobId = c.req.param("jobId");
  const job = await dlq.getJob(jobId);

  if (!job) {
    return c.json({ status: "not found" }, 404);
  }

  await job.remove();

  logger.info({ jobId }, "DLQ job removed");
  return c.json({ status: "ok", removed: jobId });
});

// Bull Board UI
const serverAdapter = new HonoAdapter(serveStatic);
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [
    new BullMQAdapter(webhookQueue),
    new BullMQAdapter(forwardQueue),
    new BullMQAdapter(dlq),
  ],
  serverAdapter,
});
app.use("/admin/queues/*", adminAuth);
app.route("/admin/queues", serverAdapter.registerPlugin());

export default app;
