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
import { getAllProviders } from "./providers.js";
import { getAllTargets } from "./config.js";
import { writeProviders, writeTargets } from "./config-writer.js";
import { renderAdminConfig } from "./ui/admin-config.js";
import type { ProviderConfig, Target } from "./types.js";

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

// Admin config UI

app.get("/admin/config", adminAuth, (c) => {
  const providers = getAllProviders();
  const targets = getAllTargets();
  const editProvider = c.req.query("editProvider");
  const editTarget = c.req.query("editTarget");
  const error = c.req.query("error");

  return c.html(
    renderAdminConfig({ providers, targets, editProvider, editTarget, error }),
  );
});

function formString(form: FormData, key: string): string {
  const val = form.get(key);
  return typeof val === "string" ? val : "";
}

function redirectWithError(
  section: "editProvider" | "editTarget",
  name: string,
  msg: string,
): string {
  const params = new URLSearchParams({ [section]: name, error: msg });
  return `/admin/config?${params.toString()}`;
}

function parseHeaders(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed: unknown = JSON.parse(trimmed);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((v) => typeof v === "string")
  ) {
    throw new Error("Headers harus object {string: string}");
  }
  return parsed as Record<string, string>;
}

app.post("/admin/config/targets", adminAuth, async (c) => {
  const form = await c.req.formData();
  const name = formString(form, "name").trim();
  const originalName = formString(form, "_original_name").trim();

  try {
    if (name.length === 0) throw new Error("Name wajib diisi");

    const target: Target = {
      name,
      url: formString(form, "url"),
      enabled: form.get("enabled") === "true",
      prefix: formString(form, "prefix"),
    };

    const timeoutRaw = formString(form, "timeoutMs").trim();
    if (timeoutRaw.length > 0) {
      const n = Number(timeoutRaw);
      if (!Number.isFinite(n) || n <= 0) throw new Error("timeoutMs harus angka positif");
      target.timeoutMs = n;
    }

    const headers = parseHeaders(formString(form, "headers"));
    if (headers) target.headers = headers;

    const current = getAllTargets();
    const searchKey = originalName.length > 0 ? originalName : name;
    const idx = current.findIndex((t) => t.name === searchKey);

    // kalau rename, pastikan nama baru ga bentrok sama entry lain
    if (originalName.length > 0 && originalName !== name) {
      const conflict = current.findIndex((t, i) => i !== idx && t.name === name);
      if (conflict >= 0) throw new Error(`Name "${name}" sudah dipakai entry lain`);
    }

    const next = idx >= 0
      ? current.map((t, i) => (i === idx ? target : t))
      : [...current, target];

    await writeTargets(next);
    logger.info({ name, originalName, action: idx >= 0 ? "update" : "add" }, "Target saved");
    return c.redirect("/admin/config");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, name }, "Target save failed");
    return c.redirect(redirectWithError("editTarget", originalName.length > 0 ? originalName : name, msg));
  }
});

app.post("/admin/config/targets/:name/delete", adminAuth, async (c) => {
  const name = c.req.param("name");
  const next = getAllTargets().filter((t) => t.name !== name);
  await writeTargets(next);
  logger.info({ name }, "Target deleted");
  return c.redirect("/admin/config");
});

app.post("/admin/config/providers", adminAuth, async (c) => {
  const form = await c.req.formData();
  const name = formString(form, "name").trim();
  const originalName = formString(form, "_original_name").trim();

  try {
    if (name.length === 0) throw new Error("Name wajib diisi");

    const verifyMethodRaw = formString(form, "verifyMethod");
    const verifyMethod = verifyMethodRaw.length > 0 ? verifyMethodRaw : "none";
    let verify: ProviderConfig["verify"];
    if (verifyMethod === "none") {
      verify = { method: "none" };
    } else {
      const headerName = formString(form, "headerName").trim();
      const envKey = formString(form, "envKey").trim();
      if (headerName.length === 0 || envKey.length === 0) {
        throw new Error("Header name dan env key wajib diisi untuk method ini");
      }
      verify = {
        method: verifyMethod as Exclude<ProviderConfig["verify"]["method"], "none">,
        headerName,
        envKey,
      };
    }

    const provider: ProviderConfig = {
      name,
      enabled: form.get("enabled") === "true",
      routingField: formString(form, "routingField"),
      verify,
    };

    const dedupField = formString(form, "dedupField").trim();
    if (dedupField.length > 0) provider.dedupField = dedupField;

    const current = getAllProviders();
    const searchKey = originalName.length > 0 ? originalName : name;
    const idx = current.findIndex((p) => p.name === searchKey);

    if (originalName.length > 0 && originalName !== name) {
      const conflict = current.findIndex((p, i) => i !== idx && p.name === name);
      if (conflict >= 0) throw new Error(`Name "${name}" sudah dipakai entry lain`);
    }

    const next = idx >= 0
      ? current.map((p, i) => (i === idx ? provider : p))
      : [...current, provider];

    await writeProviders(next);
    logger.info({ name, originalName, action: idx >= 0 ? "update" : "add" }, "Provider saved");
    return c.redirect("/admin/config");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, name }, "Provider save failed");
    return c.redirect(redirectWithError("editProvider", originalName.length > 0 ? originalName : name, msg));
  }
});

app.post("/admin/config/providers/:name/delete", adminAuth, async (c) => {
  const name = c.req.param("name");
  const next = getAllProviders().filter((p) => p.name !== name);
  await writeProviders(next);
  logger.info({ name }, "Provider deleted");
  return c.redirect("/admin/config");
});

export default app;
