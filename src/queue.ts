import "dotenv/config";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

export const redisConfig = {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
};

export const redis = new Redis(redisConfig);

// bullmq worker butuh koneksi sendiri (blocking command), jadi bikin factory
export function createWorkerConnection(name: string): Redis {
    return new Redis({ ...redisConfig, connectionName: `webhook-hub:${name}` });
}

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: false,
}

export const webhookQueue = new Queue("xendit-webhook", {
    connection: redis,
    prefix: "webhook-bridge",
    defaultJobOptions,
});

export const forwardQueue = new Queue("forward", {
    connection: redis,
    prefix: "webhook-bridge",
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential" as const, delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: false,
    },
});

// job yang gagal setelah max retry masuk sini
export const dlq = new Queue("dead-letter", {
    connection: redis,
    prefix: "webhook-bridge",
});
