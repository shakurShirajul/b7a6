import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import config from "../config/index.js";
import { drainJobs } from "./drain.js";
import { processExpirations } from "./expiration.worker.js";
import { processMatchingJob } from "./matching.worker.js";
import { processNotificationJob } from "./notification.worker.js";
import {
  EMAIL_NOTIFICATION_JOB,
  type EmailNotificationJobData,
  MATCH_BLOOD_REQUEST_JOB,
  type MatchBloodRequestJobData,
  MATCHING_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  publishPendingOutboxEvents,
  recoverFailedOutboxJob,
} from "./queue.js";

export const runBackgroundJobs = async () => {
  // Stop acquiring jobs after 90s; allow the current bounded operation to finish.
  // Vercel's configured 300s limit stays below the 360s job lock lifetime.
  const deadline = Date.now() + 90_000;
  const expiration = await processExpirations();
  if (!config.redis_url || !config.email.smtp_host || !config.email.from) {
    throw new Error("BACKGROUND_CONFIGURATION_MISSING");
  }
  const publication = await publishPendingOutboxEvents({ limit: 100 });
  const emails = await runQueue<
    EmailNotificationJobData,
    typeof EMAIL_NOTIFICATION_JOB
  >(NOTIFICATION_QUEUE_NAME, processNotificationJob, deadline, 20);
  const matching = await runQueue<
    MatchBloodRequestJobData,
    typeof MATCH_BLOOD_REQUEST_JOB
  >(MATCHING_QUEUE_NAME, processMatchingJob, deadline, 2);
  return { expiration, publication, emails, matching };
};

const runQueue = async <
  Data extends { outboxEventId: number },
  Name extends string,
>(
  name: string,
  process: (job: Job<Data, void, Name>) => Promise<unknown>,
  deadline: number,
  limit: number,
) => {
  // Supply ioredis explicitly, including for ESM serverless bundles.
  const connection = new Redis(config.redis_url!, {
    maxRetriesPerRequest: null,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    retryStrategy: () => null,
  });
  connection.on("error", () => undefined);
  try {
    const worker = new Worker<Data, void, Name>(name, null, {
      connection,
      autorun: false,
      lockDuration: 360_000,
    });
    worker.on("error", () =>
      console.error("Scheduled worker connection error"),
    );
    return await drainJobs(
      worker,
      process,
      recoverFailedOutboxJob,
      deadline,
      limit,
    );
  } finally {
    connection.disconnect();
  }
};
