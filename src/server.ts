import "dotenv/config";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import logger from "./logger.js";
import { webhookQueue, forwardQueue, dlq, redis } from "./queue.js";
import { rateLimiter } from "./middleware/rate-limit.js";
import { adminAuth } from "./middleware/admin-auth.js";

const XENDIT_CALLBACK_TOKEN = process.env.XENDIT_CALLBACK_TOKEN ?? "";

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

app.post(
  "/webhook/xendit",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ status: "payload too large" }, 413),
  }),
  rateLimiter,
  async (c) => {
    if (XENDIT_CALLBACK_TOKEN.length === 0) {
      logger.error("XENDIT_CALLBACK_TOKEN is not configured");
      return c.json({ status: "server misconfigured" }, 500);
    }

    const incomingToken = c.req.header("x-callback-token") ?? "";

    if (
      incomingToken.length !== XENDIT_CALLBACK_TOKEN.length ||
      !timingSafeEqual(
        Buffer.from(incomingToken),
        Buffer.from(XENDIT_CALLBACK_TOKEN),
      )
    ) {
      logger.warn(
        { ip: c.req.header("x-forwarded-for") ?? "unknown" },
        "Invalid callback token",
      );
      return c.json({ status: "unauthorized" }, 403);
    }

    const body: unknown = await c.req.json();
    const id = randomUUID();

    // skip kalau webhook ini sudah pernah masuk (dedup 24 jam)
    if (
      typeof body === "object" &&
      body !== null &&
      "id" in body &&
      typeof body.id === "string"
    ) {
      const dedupKey = `dedup:xendit:${body.id}`;
      const isNew = await redis.set(dedupKey, "1", "EX", 86400, "NX");
      if (!isNew) {
        logger.info({ xenditId: body.id }, "Duplicate webhook, skipping");
        return c.json({ status: "ok", id: body.id, duplicate: true }, 200);
      }
    }

    try {
      await webhookQueue.add("incoming", {
        id,
        receivedAt: new Date().toISOString(),
        headers: Object.fromEntries(c.req.raw.headers),
        body,
      });

      logger.info({ webhookId: id }, "Webhook enqueued");
      return c.json({ status: "ok", id }, 200);
    } catch (err) {
      logger.error({ err, webhookId: id }, "Failed to enqueue");
      return c.json({ status: "error" }, 500);
    }
  },
);

// Admin endpoint

app.get("/admin/dlq", adminAuth, async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);

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

  const data = job.data as { webhook?: unknown; target?: unknown };
  await forwardQueue.add("forward", {
    webhook: data.webhook,
    target: data.target,
    dispatchedAt: new Date().toISOString(),
  });

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
