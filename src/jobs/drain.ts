import { randomUUID } from "node:crypto";

type QueueJob = {
  moveToCompleted: (
    value: void,
    token: string,
    fetchNext: false,
  ) => Promise<unknown>;
  moveToFailed: (
    error: Error,
    token: string,
    fetchNext: false,
  ) => Promise<unknown>;
};

type ManualWorker<J> = {
  startStalledCheckTimer: () => Promise<void>;
  getNextJob: (
    token: string,
    options: { block: false },
  ) => Promise<J | undefined>;
  close: () => Promise<void>;
};

// No background loop survives the HTTP response. BullMQ owns job locks and retries.
export const drainJobs = async <J extends QueueJob>(
  worker: ManualWorker<J>,
  process: (job: J) => Promise<unknown>,
  recover: (job: J) => Promise<unknown>,
  deadline: number,
  limit: number,
) => {
  const result = { completed: 0, failed: 0 };
  try {
    await worker.startStalledCheckTimer();
    for (let count = 0; count < limit && Date.now() < deadline; count++) {
      const token = randomUUID();
      const job = await worker.getNextJob(token, { block: false });
      if (!job) break;
      try {
        await process(job);
      } catch {
        // Provider errors can contain credentials or recipient information.
        await job.moveToFailed(
          new Error("BACKGROUND_JOB_FAILED"),
          token,
          false,
        );
        await recover(job);
        result.failed++;
        continue;
      }
      await job.moveToCompleted(undefined, token, false);
      result.completed++;
    }
    return result;
  } finally {
    await worker.close();
  }
};
