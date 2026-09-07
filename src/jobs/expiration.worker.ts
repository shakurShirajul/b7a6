import { Worker, type Job } from "bullmq";
import config from "../config/index.js";
import {
  AssignmentStatus,
  BloodRequestStatus,
  NotificationDeliveryStatus,
} from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { invalidateDashboardCache } from "../shared/dashboard-cache.js";
import {
  createWorkerConnectionOptions,
  EXPIRATION_QUEUE_NAME,
  EXPIRATION_SWEEP_JOB,
  type ExpirationSweepJobData,
  getExpirationQueue,
  runProducerOperation,
} from "./queue.js";

const activeRequestStatuses = [
  BloodRequestStatus.VERIFIED,
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
] as const;

const expireInvitations = (now: Date) =>
  prisma.$transaction(async (transaction) => {
    const staleInvitations = await transaction.donorAssignment.findMany({
      where: { status: AssignmentStatus.INVITED, expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: "asc" },
      take: config.matching.expiration_batch_size,
    });
    const assignmentIds = staleInvitations.map(({ id }) => id);
    if (assignmentIds.length === 0) return 0;

    const result = await transaction.donorAssignment.updateMany({
      where: {
        id: { in: assignmentIds },
        status: AssignmentStatus.INVITED,
        expiresAt: { lte: now },
      },
      data: { status: AssignmentStatus.EXPIRED, respondedAt: now },
    });
    await transaction.notification.updateMany({
      where: {
        donorAssignmentId: { in: assignmentIds },
        deliveryStatus: NotificationDeliveryStatus.PENDING,
      },
      data: { deliveryStatus: NotificationDeliveryStatus.FAILED },
    });
    return result.count;
  });

const expireReservations = (now: Date) =>
  prisma.$transaction(async (transaction) => {
    const staleReservations = await transaction.donorReservation.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, assignmentId: true },
      orderBy: { expiresAt: "asc" },
      take: config.matching.expiration_batch_size,
    });
    if (staleReservations.length === 0) return 0;

    await transaction.donorAssignment.updateMany({
      where: {
        id: { in: staleReservations.map(({ assignmentId }) => assignmentId) },
        status: AssignmentStatus.ACCEPTED,
      },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    const deleted = await transaction.donorReservation.deleteMany({
      where: { id: { in: staleReservations.map(({ id }) => id) } },
    });
    return deleted.count;
  });

const expireOverdueRequests = (now: Date) =>
  prisma.$transaction(async (transaction) => {
    const overdueRequests = await transaction.bloodRequest.findMany({
      where: {
        status: { in: [...activeRequestStatuses] },
        requiredAt: { lte: now },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { requiredAt: "asc" },
      take: config.matching.expiration_batch_size,
    });
    const requestIds = overdueRequests.map(({ id }) => id);
    if (requestIds.length === 0) {
      return { requests: 0, assignments: 0, reservations: 0 };
    }

    const requests = await transaction.bloodRequest.updateMany({
      where: {
        id: { in: requestIds },
        status: { in: [...activeRequestStatuses] },
        requiredAt: { lte: now },
        deletedAt: null,
      },
      data: { status: BloodRequestStatus.EXPIRED },
    });
    const assignments = await transaction.donorAssignment.updateMany({
      where: {
        bloodRequestId: { in: requestIds },
        status: { in: [AssignmentStatus.INVITED, AssignmentStatus.ACCEPTED] },
      },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    const reservations = await transaction.donorReservation.deleteMany({
      where: { bloodRequestId: { in: requestIds } },
    });
    return {
      requests: requests.count,
      assignments: assignments.count,
      reservations: reservations.count,
    };
  });

export const processExpirations = async (now = new Date()) => {
  const invitations = await expireInvitations(now);
  const reservations = await expireReservations(now);
  const overdue = await expireOverdueRequests(now);
  if (overdue.requests > 0) await invalidateDashboardCache();
  return { invitations, reservations, overdue };
};

const processExpirationJob = async (
  job: Job<ExpirationSweepJobData, void, typeof EXPIRATION_SWEEP_JOB>,
) => {
  if (job.name !== EXPIRATION_SWEEP_JOB) {
    throw new Error("Unsupported expiration job");
  }
  await processExpirations();
};

export const startExpirationWorker = async () => {
  const worker = new Worker<
    ExpirationSweepJobData,
    void,
    typeof EXPIRATION_SWEEP_JOB
  >(EXPIRATION_QUEUE_NAME, processExpirationJob, {
    connection: createWorkerConnectionOptions(),
    concurrency: 1,
  });
  worker.on("failed", (job) => {
    console.error("Expiration sweep job failed", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
    });
  });
  worker.on("error", () => {
    console.error("Expiration worker error");
  });

  try {
    await runProducerOperation(() =>
      getExpirationQueue().upsertJobScheduler(
        EXPIRATION_SWEEP_JOB,
        { every: 60_000 },
        {
          name: EXPIRATION_SWEEP_JOB,
          data: {},
        },
      ),
    );
  } catch (error) {
    await worker.close().catch(() => undefined);
    throw error;
  }
  return worker;
};
