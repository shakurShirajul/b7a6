import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config/index.js", () => ({
  default: {
    readiness_timeout_ms: 1500,
    readiness_startup_timeout_ms: 10000,
    redis_url: undefined,
  },
}));
vi.mock("./lib/prisma.js", () => ({ prisma: {} }));

import { createReadinessChecker } from "./readiness.js";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("readiness startup allowance", () => {
  it("waits for a healthy cold connection beyond the warm deadline", async () => {
    const check = createReadinessChecker({
      databaseProbe: () => delay(2000),
      redisRequired: false,
    });
    const result = check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(true);
  });

  it("returns false when startup never finishes", async () => {
    const check = createReadinessChecker({
      databaseProbe: () => new Promise(() => {}),
      redisRequired: false,
    });
    const result = check();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBe(false);
  });

  it("uses the short deadline after the first successful check", async () => {
    let slow = false;
    const check = createReadinessChecker({
      databaseProbe: () => delay(slow ? 2000 : 20),
      redisRequired: false,
    });
    const first = check();
    await vi.advanceTimersByTimeAsync(20);
    expect(await first).toBe(true);
    slow = true;
    const second = check();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await second).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
  });

  it("does not hide a required dependency failure during startup", async () => {
    const check = createReadinessChecker({
      databaseProbe: async () => {},
      redisProbe: async () => {
        throw new Error("unavailable");
      },
      redisRequired: true,
    });
    expect(await check()).toBe(false);
  });

  it("shares a cold probe across concurrent callers", async () => {
    let calls = 0;
    const check = createReadinessChecker({
      databaseProbe: () => {
        calls++;
        return delay(2000);
      },
      redisRequired: false,
    });
    const results = Promise.all([check(), check(), check()]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await results).toEqual([true, true, true]);
    expect(calls).toBe(1);
  });

  it("passes the startup then warm budget to dependency probes", async () => {
    const budgets: number[] = [];
    const check = createReadinessChecker({
      databaseProbe: async () => {},
      redisProbe: async (timeoutMs: number) => {
        budgets.push(timeoutMs);
      },
      redisRequired: true,
    });
    expect(await check()).toBe(true);
    expect(await check()).toBe(true);
    expect(budgets).toEqual([10000, 1500]);
  });
});
