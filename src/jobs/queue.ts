import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import config from "../config/index.js";
import { Prisma } from "../generated/prisma/client.js";
import type { Urgency } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { withRedisTimeout } from "../shared/redis-timeout.js";
import { requestQueuePriority } from "./request-priority.js";

export const NOTIFICATION_QUEUE_NAME = "notifications";
export const MATCHING_QUEUE_NAME = "matching";
export const EXPIRATION_QUEUE_NAME = "expiration";

export const EMAIL_NOTIFICATION_JOB = "send-notification-email" as const;
export const MATCH_BLOOD_REQUEST_JOB = "match-blood-request" as const;
export const EXPIRATION_SWEEP_JOB = "expire-stale-records" as const;

export type EmailNotificationJobData = {
  outboxEventId: number;
  notificationId: number;
};

export type MatchBloodRequestJobData = {
  outboxEventId: number;
  bloodRequestId: number;
  radiusKm?: number;
};

export type ExpirationSweepJobData = Record<string, never>;

const notificationJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
};

const matchingJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
};

const expirationJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
};

const requireRedisUrl = () => {
  if (!config.redis_url) {
    throw new Error(
      "REDIS_URL is required to publish or process background jobs",
    );
  }
  return config.redis_url;
};

export const isQueueConfigured = () => Boolean(config.redis_url);

export const createProducerConnectionOptions = (): RedisOptions => ({
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: config.redis_command_timeout_ms,
  commandTimeout: config.redis_command_timeout_ms,
  retryStrategy: () => null,
});

const producerConnections = new Set<Redis>();
let producerUnavailableUntil = 0;
const createProducerConnection = () => {
  const redis = new Redis(requireRedisUrl(), createProducerConnectionOptions());
  redis.on("error", () => undefined);
  producerConnections.add(redis);
  return redis;
};

export const createWorkerConnectionOptions = (): ConnectionOptions => ({
  url: requireRedisUrl(),
  maxRetriesPerRequest: null,
});

let notificationQueue:
  | Queue<EmailNotificationJobData, void, typeof EMAIL_NOTIFICATION_JOB>
  | undefined;
let matchingQueue:
  | Queue<MatchBloodRequestJobData, void, typeof MATCH_BLOOD_REQUEST_JOB>
  | undefined;
let expirationQueue:
  Queue<ExpirationSweepJobData, void, typeof EXPIRATION_SWEEP_JOB> | undefined;

export const getNotificationQueue = () => {
  if (!notificationQueue) {
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
      connection: createProducerConnection(),
      defaultJobOptions: notificationJobOptions,
    });
    notificationQueue.on("error", () => {
      console.error("Notification queue connection error");
    });
  }
  return notificationQueue;
};

export const getMatchingQueue = () => {
  if (!matchingQueue) {
    matchingQueue = new Queue(MATCHING_QUEUE_NAME, {
      connection: createProducerConnection(),
      defaultJobOptions: matchingJobOptions,
    });
    matchingQueue.on("error", () => {
      console.error("Matching queue connection error");
    });
  }
  return matchingQueue;
};

export const getExpirationQueue = () => {
  if (!expirationQueue) {
    expirationQueue = new Queue(EXPIRATION_QUEUE_NAME, {
      connection: createProducerConnection(),
      defaultJobOptions: expirationJobOptions,
    });
    expirationQueue.on("error", () => {
      console.error("Expiration queue connection error");
    });
  }
  return expirationQueue;
};

const disconnectProducers = () => {
  for (const connection of producerConnections) connection.disconnect();
  producerConnections.clear();
  notificationQueue = undefined;
  matchingQueue = undefined;
  expirationQueue = undefined;
  producerUnavailableUntil = Date.now() + 30_000;
};

export const runProducerOperation = <T>(
  operation: () => Promise<T>,
  timeoutMs?: number,
) => withRedisTimeout(operation, disconnectProducers, timeoutMs);

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getPositiveInteger = (
  payload: Record<string, unknown>,
  key: string,
): number => {
  const value = payload[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Outbox payload is missing ${key}`);
  }
  return Number(value);
};

type PublishableOutboxEvent = {
  id: number;
  type: string;
  payload: unknown;
  attempts: number;
  availableAt: Date;
  urgency: Urgency | null;
  requiredAt: Date | null;
};

const recoveryDelayMs = (attempts: number) =>
  Math.min(60 * 60_000, 60_000 * 2 ** Math.min(attempts, 6));

const publishOutboxEvent = async (event: PublishableOutboxEvent, now: Date) => {
  if (!isJsonRecord(event.payload)) {
    throw new Error("Outbox payload must be an object");
  }
  const jobId = `outbox-${event.id}`;
  const queue =
    event.type === "MATCH_BLOOD_REQUEST"
      ? getMatchingQueue()
      : getNotificationQueue();
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed") return { completed: true } as const;
    if (state === "failed") {
      const retryAt = new Date(
        (existing.finishedOn ?? now.getTime()) +
          recoveryDelayMs(event.attempts),
      );
      if (retryAt > now) return { retryAt } as const;
      // Retained failed jobs deduplicate add(jobId). Remove only that terminal
      // job, under a durable publication lease, before replaying the same ID.
      await existing.remove();
    } else if (state !== "unknown") {
      return { queued: true } as const;
    }
  }

  switch (event.type) {
    case "MATCH_BLOOD_REQUEST": {
      const bloodRequestId = getPositiveInteger(
        event.payload,
        "bloodRequestId",
      );
      const radiusValue = event.payload.radiusKm;
      const radiusKm =
        typeof radiusValue === "number" && Number.isFinite(radiusValue)
          ? radiusValue
          : undefined;
      await getMatchingQueue().add(
        MATCH_BLOOD_REQUEST_JOB,
        { outboxEventId: event.id, bloodRequestId, radiusKm },
        {
          jobId,
          priority:
            event.urgency && event.requiredAt
              ? requestQueuePriority(event.urgency, event.requiredAt)
              : requestQueuePriority("NORMAL", now),
        },
      );
      return { queued: true } as const;
    }
    case "SEND_DONOR_INVITATION_EMAIL": {
      const notificationId = getPositiveInteger(
        event.payload,
        "notificationId",
      );
      await getNotificationQueue().add(
        EMAIL_NOTIFICATION_JOB,
        { outboxEventId: event.id, notificationId },
        { jobId },
      );
      return { queued: true } as const;
    }
    case "SEND_NOTIFICATION_EMAIL": {
      const notificationId = getPositiveInteger(
        event.payload,
        "notificationId",
      );
      await getNotificationQueue().add(
        EMAIL_NOTIFICATION_JOB,
        { outboxEventId: event.id, notificationId },
        { jobId },
      );
      return { queued: true } as const;
    }
    default:
      throw new Error("Unsupported outbox event type");
  }
};

export const completeOutboxEvent = async (outboxEventId: number) => {
  await prisma.outboxEvent.updateMany({
    where: { id: outboxEventId, completedAt: null },
    data: { completedAt: new Date(), lastError: null },
  });
};

export const recoverFailedOutboxJob = async (
  job:
    | {
        data: { outboxEventId: number };
        attemptsMade: number;
        opts: { attempts?: number };
      }
    | undefined,
) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const event = await prisma.outboxEvent.findUnique({
    where: { id: job.data.outboxEventId },
    select: {
      attempts: true,
      completedAt: true,
      lastError: true,
      availableAt: true,
    },
  });
  if (
    !event ||
    event.completedAt ||
    event.lastError === "JOB_ATTEMPTS_EXHAUSTED"
  )
    return;
  await prisma.outboxEvent.updateMany({
    where: {
      id: job.data.outboxEventId,
      completedAt: null,
      attempts: event.attempts,
      availableAt: event.availableAt,
    },
    data: {
      processedAt: null,
      attempts: { increment: 1 },
      availableAt: new Date(Date.now() + recoveryDelayMs(event.attempts + 1)),
      lastError: "JOB_ATTEMPTS_EXHAUSTED",
    },
  });
};

const publicationRetryAt = (attempts: number, now: Date) => {
  const seconds = Math.min(15 * 60, 2 ** Math.min(attempts, 9));
  return new Date(now.getTime() + seconds * 1_000);
};

export type PublishPendingOutboxOptions = {
  ids?: readonly number[];
  limit?: number;
};

export type OutboxPublicationResult = {
  inspected: number;
  published: number;
  deferred: number;
};

export const publishPendingOutboxEvents = async (
  options: PublishPendingOutboxOptions = {},
): Promise<OutboxPublicationResult> => {
  if (options.ids?.length === 0) {
    return { inspected: 0, published: 0, deferred: 0 };
  }

  const limit = Math.max(1, Math.min(options.limit ?? 100, 1_000));
  const now = new Date();
  // Order the finite due batch in PostgreSQL before LIMIT. Current request data
  // is authoritative even for outbox events created by an older application.
  const events = await prisma.$queryRaw<PublishableOutboxEvent[]>(Prisma.sql`
    SELECT e."id", e."type", e."payload", e."attempts", e."availableAt",
      br."urgency", br."requiredAt"
    FROM "OutboxEvent" e
    LEFT JOIN "BloodRequest" br ON e."type" = 'MATCH_BLOOD_REQUEST'
      AND br."id"::text = e."payload"->>'bloodRequestId'
    WHERE e."completedAt" IS NULL AND e."availableAt" <= ${now}
      ${options.ids ? Prisma.sql`AND e."id" IN (${Prisma.join([...options.ids])})` : Prisma.empty}
    ORDER BY CASE WHEN e."type" = 'MATCH_BLOOD_REQUEST' THEN 0 ELSE 1 END,
      CASE br."urgency" WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
      br."requiredAt" ASC NULLS LAST, e."id" ASC
    LIMIT ${limit}
  `);

  const relevantWhere = {
    id: options.ids ? { in: [...options.ids] } : undefined,
    processedAt: null,
    completedAt: null,
  } as const;

  if (!isQueueConfigured() || Date.now() < producerUnavailableUntil) {
    const deferred = await prisma.outboxEvent.count({ where: relevantWhere });
    if (deferred > 0) {
      console.warn("Outbox publication deferred: Redis is not configured", {
        eventCount: deferred,
      });
    }
    return { inspected: events.length, published: 0, deferred };
  }

  let published = 0;
  const redisDeadline = Date.now() + config.redis_command_timeout_ms;
  for (const event of events) {
    if (Date.now() >= redisDeadline) break;
    const leaseUntil = new Date(Date.now() + 15 * 60_000);
    const claim = await prisma.outboxEvent.updateMany({
      where: {
        id: event.id,
        completedAt: null,
        availableAt: event.availableAt,
        attempts: event.attempts,
      },
      data: { availableAt: leaseUntil },
    });
    if (claim.count !== 1) continue;
    const claimedWhere = {
      id: event.id,
      completedAt: null,
      availableAt: leaseUntil,
      attempts: event.attempts,
    };
    try {
      const outcome = await runProducerOperation(
        () => publishOutboxEvent(event, now),
        redisDeadline - Date.now(),
      );
      if ("retryAt" in outcome) {
        await prisma.outboxEvent.updateMany({
          where: claimedWhere,
          data: {
            processedAt: null,
            availableAt: outcome.retryAt,
            lastError: "JOB_ATTEMPTS_EXHAUSTED",
          },
        });
        continue;
      }
      await prisma.outboxEvent.updateMany({
        where: claimedWhere,
        data: {
          processedAt: new Date(),
          lastError: null,
          ...("completed" in outcome ? { completedAt: new Date() } : {}),
        },
      });
      published += 1;
    } catch {
      console.error("Outbox publication deferred", {
        eventId: event.id,
        eventType: event.type,
      });
      try {
        await prisma.outboxEvent.updateMany({
          where: claimedWhere,
          data: {
            processedAt: null,
            attempts: { increment: 1 },
            availableAt: publicationRetryAt(event.attempts + 1, now),
            lastError: "QUEUE_PUBLICATION_FAILED",
          },
        });
      } catch {
        console.error("Could not persist deferred outbox publication state", {
          eventId: event.id,
          eventType: event.type,
        });
      }
      // A connected but non-responsive Redis must not cost a timeout per event.
      disconnectProducers();
      break;
    }
  }

  const deferred = await prisma.outboxEvent.count({ where: relevantWhere });
  return { inspected: events.length, published, deferred };
};

export const startOutboxPublisher = (
  intervalMs = 5_000,
  publishSweep: () => Promise<unknown> = publishPendingOutboxEvents,
) => {
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw new RangeError("Outbox publisher interval must be at least 1000 ms");
  }

  let stopped = false;
  let activePublish: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const publish = async () => {
    if (stopped) return;
    if (activePublish) {
      await activePublish;
      return;
    }

    const sweep = (async () => {
      try {
        await publishSweep();
      } catch {
        console.error("Outbox publisher sweep failed");
      }
    })();
    activePublish = sweep;
    await sweep;
    if (activePublish === sweep) activePublish = undefined;
  };
  void publish();
  const timer = setInterval(() => void publish(), intervalMs);
  timer.unref();
  return () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(timer);
    stopPromise = (async () => {
      await activePublish;
    })();
    return stopPromise;
  };
};

let queuesClosePromise: Promise<void> | undefined;

export const closeQueues = () => {
  if (queuesClosePromise) return queuesClosePromise;

  const queues = [notificationQueue, matchingQueue, expirationQueue].filter(
    (queue) => queue !== undefined,
  );
  notificationQueue = undefined;
  matchingQueue = undefined;
  expirationQueue = undefined;
  queuesClosePromise = (async () => {
    const results = await Promise.allSettled(
      queues.map((queue) => runProducerOperation(() => queue.close())),
    );
    disconnectProducers();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more queues failed to close");
    }
  })().finally(() => {
    queuesClosePromise = undefined;
  });
  return queuesClosePromise;
};
