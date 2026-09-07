import config from "../config/index.js";

// Bound connection initialization as well as command chains. Disconnecting on
// timeout prevents pending commands from lingering after the caller falls back.
export const withRedisTimeout = async <T>(
  operation: () => Promise<T>,
  disconnect: () => void,
  timeoutMs = config.redis_command_timeout_ms,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => {
            disconnect();
            reject(new Error("Redis operation timed out"));
          },
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
