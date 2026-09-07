import { Redis, type RedisStatus } from "ioredis";
import config from "./config/index.js";
import { prisma } from "./lib/prisma.js";
import { withRedisTimeout } from "./shared/redis-timeout.js";

type ReadinessProbe = (timeoutMs: number) => Promise<unknown>;

type ReadinessCheckerOptions = {
  databaseProbe?: ReadinessProbe;
  redisProbe?: ReadinessProbe;
  redisRequired?: boolean;
  timeoutMs?: number;
  startupTimeoutMs?: number;
};

type RedisReadinessClient = {
  status: RedisStatus;
  connect: () => Promise<void>;
  ping: () => Promise<unknown>;
  once: Redis["once"];
  off: Redis["off"];
};

const withTimeout = async (
  probe: () => Promise<unknown>,
  timeoutMs: number,
) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Readiness probe timed out")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const waitForRedisReady = async (
  redis: RedisReadinessClient,
  timeoutMs: number,
) => {
  if (redis.status === "ready") return;

  let timeout: NodeJS.Timeout | undefined;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      redis.off("ready", onReady);
      redis.off("error", onError);
      redis.off("end", onEnd);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Redis readiness connection failed"));
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Redis readiness connection ended"));
    };

    redis.once("ready", onReady);
    redis.once("error", onError);
    redis.once("end", onEnd);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Redis readiness connection timed out"));
    }, timeoutMs);
    timeout.unref();
  });
};

export const pingRedisWhenReady = async (
  redis: RedisReadinessClient,
  timeoutMs: number,
) => {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  if (redis.status !== "ready") {
    await waitForRedisReady(redis, timeoutMs);
  }

  if (redis.status !== "ready") {
    throw new Error("Redis readiness connection is not ready");
  }
  await redis.ping();
};

let readinessRedis: Redis | undefined;
let readinessClosing: Promise<void> | undefined;

const getReadinessRedis = (timeoutMs: number) => {
  if (!config.redis_url) {
    throw new Error("Redis is not configured");
  }
  if (readinessClosing) {
    throw new Error("Readiness resources are closing");
  }

  if (!readinessRedis) {
    readinessRedis = new Redis(config.redis_url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: timeoutMs,
      commandTimeout: Math.min(
        config.readiness_timeout_ms,
        config.redis_command_timeout_ms,
      ),
      retryStrategy: () => null,
    });
    readinessRedis.on("error", () => {
      // The readiness response intentionally omits provider error details.
    });
  }

  return readinessRedis;
};

const defaultDatabaseProbe = () => prisma.$queryRaw`SELECT 1`;
const defaultRedisProbe = async (timeoutMs: number) => {
  const redis = getReadinessRedis(timeoutMs);
  try {
    await withRedisTimeout(
      () => pingRedisWhenReady(redis, timeoutMs),
      () => redis.disconnect(),
      timeoutMs,
    );
  } catch (error) {
    redis.disconnect();
    if (readinessRedis === redis) readinessRedis = undefined;
    throw error;
  }
};

export const createReadinessChecker = (
  options: ReadinessCheckerOptions = {},
) => {
  const databaseProbe = options.databaseProbe ?? defaultDatabaseProbe;
  const redisProbe = options.redisProbe ?? defaultRedisProbe;
  const redisRequired =
    options.redisRequired ??
    (process.env.NODE_ENV === "production" || Boolean(config.redis_url));
  const timeoutMs = options.timeoutMs ?? config.readiness_timeout_ms;
  const startupTimeoutMs = Math.max(
    timeoutMs,
    options.startupTimeoutMs ?? config.readiness_startup_timeout_ms,
  );
  let hasBeenReady = false;
  let activeProbe: Promise<boolean> | undefined;

  const runProbes = async (budgetMs: number) => {
    const probes = [Promise.resolve().then(() => databaseProbe(budgetMs))];
    if (redisRequired) {
      probes.push(Promise.resolve().then(() => redisProbe(budgetMs)));
    }
    const results = await Promise.allSettled(probes);
    return results.every((result) => result.status === "fulfilled");
  };

  return async () => {
    // New serverless instances need time to establish dependency connections.
    // After the first success, keep the short deadline for outage detection.
    const budgetMs = hasBeenReady ? timeoutMs : startupTimeoutMs;
    if (!activeProbe) {
      const probe = runProbes(budgetMs);
      activeProbe = probe;
      void probe.finally(() => {
        if (activeProbe === probe) activeProbe = undefined;
      });
    }
    const probe = activeProbe!;

    try {
      let ready = false;
      await withTimeout(async () => {
        ready = await probe;
      }, budgetMs);
      if (ready) hasBeenReady = true;
      return ready;
    } catch {
      return false;
    }
  };
};

export const checkReadiness = createReadinessChecker();

export const closeReadinessResources = () => {
  if (readinessClosing) return readinessClosing;

  const redis = readinessRedis;
  readinessRedis = undefined;
  readinessClosing = (async () => {
    if (!redis) return;

    if (redis.status === "wait" || redis.status === "end") {
      redis.disconnect();
      return;
    }

    try {
      await withTimeout(() => redis.quit(), config.readiness_timeout_ms);
    } catch {
      redis.disconnect();
    }
  })();
  return readinessClosing;
};
