import { Redis } from "ioredis";
import config from "../config/index.js";
import { withRedisTimeout } from "./redis-timeout.js";

const dashboardCachePrefix = "blood-platform:admin-dashboard:";
const dashboardCacheGenerationKey = `${dashboardCachePrefix}generation`;
const dashboardCacheTtlSeconds = 15;
const redisRetryDelayMs = 30_000;

type LocalCacheEntry = {
  value: unknown;
  expiresAt: number;
  localGeneration: number;
  redisGeneration: string | null;
};

export type DashboardCacheVersion = Readonly<{
  localGeneration: number;
  redisGeneration: string | null;
}>;

export type DashboardCacheSnapshot<T> = Readonly<{
  value: T | null;
  version: DashboardCacheVersion;
}>;

const localCache = new Map<string, LocalCacheEntry>();
let localGeneration = 0;
let redisClient: Redis | undefined;
let redisUnavailableUntil = 0;
let dashboardCacheClosing = false;
let dashboardCacheClosePromise: Promise<void> | undefined;

const getRedisClient = async () => {
  if (
    dashboardCacheClosing ||
    !config.redis_url ||
    Date.now() < redisUnavailableUntil
  ) {
    return null;
  }

  try {
    if (!redisClient) {
      redisClient = new Redis(config.redis_url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1_000,
        commandTimeout: config.redis_command_timeout_ms,
        retryStrategy: () => null,
      });
      redisClient.on("error", () => undefined);
    }
    if (redisClient.status === "wait") {
      const redis = redisClient;
      await withRedisTimeout(
        () => redis.connect(),
        () => redis.disconnect(),
      );
    }
    return redisClient;
  } catch {
    redisClient?.disconnect();
    redisClient = undefined;
    redisUnavailableUntil = Date.now() + redisRetryDelayMs;
    return null;
  }
};

const markRedisUnavailable = () => {
  redisClient?.disconnect();
  redisClient = undefined;
  redisUnavailableUntil = Date.now() + redisRetryDelayMs;
};

const getRedisGeneration = async (redis: Redis) =>
  (await redis.get(dashboardCacheGenerationKey)) ?? "0";

const localSnapshot = <T>(key: string): DashboardCacheSnapshot<T> => {
  const local = localCache.get(key);
  const version = { localGeneration, redisGeneration: null };
  if (
    local &&
    local.expiresAt > Date.now() &&
    local.localGeneration === localGeneration
  ) {
    return { value: local.value as T, version };
  }
  if (local) localCache.delete(key);
  return { value: null, version };
};

export const getDashboardCache = async <T>(
  key: string,
): Promise<DashboardCacheSnapshot<T>> => {
  const redis = await getRedisClient();
  if (!redis) return localSnapshot<T>(key);
  try {
    const redisGeneration = await getRedisGeneration(redis);
    const version = { localGeneration, redisGeneration };
    const local = localCache.get(key);
    if (
      local &&
      local.expiresAt > Date.now() &&
      local.localGeneration === version.localGeneration &&
      local.redisGeneration === redisGeneration
    ) {
      return { value: local.value as T, version };
    }
    if (local) localCache.delete(key);
    const serialized = await redis.get(
      `${dashboardCachePrefix}${redisGeneration}:${key}`,
    );
    if (!serialized) return { value: null, version };
    const value = JSON.parse(serialized) as T;
    localCache.set(key, {
      value,
      expiresAt: Date.now() + dashboardCacheTtlSeconds * 1_000,
      localGeneration: version.localGeneration,
      redisGeneration,
    });
    return { value, version };
  } catch {
    markRedisUnavailable();
    return localSnapshot<T>(key);
  }
};

const compareAndSetScript = `
  local generation = redis.call("GET", KEYS[1]) or "0"
  if generation ~= ARGV[1] then
    return 0
  end
  redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
  return 1
`;

export const setDashboardCache = async (
  key: string,
  value: unknown,
  expectedVersion: DashboardCacheVersion,
) => {
  if (localGeneration !== expectedVersion.localGeneration) return false;
  const redis = await getRedisClient();
  if (localGeneration !== expectedVersion.localGeneration) return false;
  if (!redis) {
    if (expectedVersion.redisGeneration !== null) return false;
    localCache.set(key, {
      value,
      expiresAt: Date.now() + dashboardCacheTtlSeconds * 1_000,
      localGeneration: expectedVersion.localGeneration,
      redisGeneration: null,
    });
    return true;
  }
  if (expectedVersion.redisGeneration === null) return false;
  try {
    const redisGeneration = expectedVersion.redisGeneration;
    const applied = await redis.eval(
      compareAndSetScript,
      2,
      dashboardCacheGenerationKey,
      `${dashboardCachePrefix}${redisGeneration}:${key}`,
      redisGeneration,
      JSON.stringify(value),
      String(dashboardCacheTtlSeconds),
    );
    if (applied !== 1 || localGeneration !== expectedVersion.localGeneration) {
      return false;
    }
    localCache.set(key, {
      value,
      expiresAt: Date.now() + dashboardCacheTtlSeconds * 1_000,
      localGeneration: expectedVersion.localGeneration,
      redisGeneration,
    });
    return true;
  } catch {
    markRedisUnavailable();
    return false;
  }
};

export const invalidateDashboardCache = async () => {
  localGeneration += 1;
  localCache.clear();
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.incr(dashboardCacheGenerationKey);
    } catch {
      markRedisUnavailable();
    }
  }
};

export const closeDashboardCache = () => {
  if (dashboardCacheClosePromise) return dashboardCacheClosePromise;

  dashboardCacheClosing = true;
  const redis = redisClient;
  redisClient = undefined;
  localCache.clear();

  dashboardCacheClosePromise = (async () => {
    if (!redis) return;
    if (redis.status === "wait" || redis.status === "end") {
      redis.disconnect();
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        redis.quit(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Dashboard cache shutdown timed out")),
            config.readiness_timeout_ms,
          );
          timeout.unref();
        }),
      ]);
    } catch {
      redis.disconnect();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();

  return dashboardCacheClosePromise;
};
