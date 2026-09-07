import { startExpirationWorker } from "./expiration.worker.js";
import { startMatchingWorker } from "./matching.worker.js";
import { startNotificationWorker } from "./notification.worker.js";
import { closeQueues, startOutboxPublisher } from "./queue.js";

export const startWorkers = async () => {
  const notificationWorker = startNotificationWorker();
  const matchingWorker = startMatchingWorker();
  let expirationWorker;
  try {
    expirationWorker = await startExpirationWorker();
  } catch (error) {
    await Promise.all([
      notificationWorker.close().catch(() => undefined),
      matchingWorker.close().catch(() => undefined),
      closeQueues().catch(() => undefined),
    ]);
    throw error;
  }
  const stopOutboxPublisher = startOutboxPublisher();
  let stopPromise: Promise<void> | undefined;

  return () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await stopOutboxPublisher();
      const results = await Promise.allSettled([
        notificationWorker.close(),
        matchingWorker.close(),
        expirationWorker.close(),
      ]);
      await closeQueues();
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "One or more workers failed to close",
        );
      }
    })();
    return stopPromise;
  };
};
