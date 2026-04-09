import "dotenv/config";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

// config (single source)
export const redisConfig = {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
};


// instance
export const redis = new Redis(redisConfig);

// Default job option
const defaultJobOptions = {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: false,
}

// forward queue

export const forwardQueue = new Queue("forward", {
    connection: redis,
    prefix: "webhook-bridge",
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: false,
    }
})

// dispatch queue
export const webhookQueue = new Queue("xendit-webhook", {
    connection: redis,
    prefix: "webhook-bridge",
    defaultJobOptions
});
