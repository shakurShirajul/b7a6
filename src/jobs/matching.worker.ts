import { Worker, type Job } from "bullmq";
import config from "../config/index.js";
import { matchDonors } from "../modules/matching/matching.service.js";
import { BloodRequestStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import {
  createWorkerConnectionOptions,
  completeOutboxEvent,
  recoverFailedOutboxJob,
  MATCH_BLOOD_REQUEST_JOB,
  type MatchBloodRequestJobData,
  MATCHING_QUEUE_NAME,
} from "./queue.js";

const processMatchingJob = async (
  job: Job<MatchBloodRequestJobData, void, typeof MATCH_BLOOD_REQUEST_JOB>,
) => {
  if (job.name !== MATCH_BLOOD_REQUEST_JOB) {
    throw new Error("Unsupported matching job");
  }
  const request = await prisma.bloodRequest.findUnique({
    where: { id: job.data.bloodRequestId },
    select: {
      status: true,
      deletedAt: true,
      requiredAt: true,
      unitsRequired: true,
      unitsFulfilled: true,
    },
  });
  const activeStatuses: BloodRequestStatus[] = [
    BloodRequestStatus.VERIFIED,
    BloodRequestStatus.MATCHING,
    BloodRequestStatus.PARTIALLY_FULFILLED,
  ];
  if (
    request &&
    !request.deletedAt &&
    request.requiredAt > new Date() &&
    request.unitsFulfilled < request.unitsRequired &&
    activeStatuses.includes(request.status)
  ) {
    await matchDonors(
      job.data.bloodRequestId,
      job.data.radiusKm ?? config.matching.default_radius_km,
    );
  }
  await completeOutboxEvent(job.data.outboxEventId);
};

export const startMatchingWorker = () => {
  const worker = new Worker<
    MatchBloodRequestJobData,
    void,
    typeof MATCH_BLOOD_REQUEST_JOB
  >(MATCHING_QUEUE_NAME, processMatchingJob, {
    connection: createWorkerConnectionOptions(),
    concurrency: 2,
  });
  worker.on("failed", (job) => {
    console.error("Blood request matching job failed", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
    });
    void recoverFailedOutboxJob(job).catch(() => {
      // The unacknowledged row is also reconciled by the bounded publisher.
      console.error("Matching outbox recovery deferred", {
        eventId: job?.data.outboxEventId,
      });
    });
  });
  worker.on("error", () => {
    console.error("Blood request matching worker error");
  });
  return worker;
};
