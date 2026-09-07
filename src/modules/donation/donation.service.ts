import httpStatus from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import {
  AssignmentStatus,
  BloodRequestStatus,
  NotificationDeliveryStatus,
  NotificationType,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { publishPendingOutboxEvents } from "../../jobs/queue.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { invalidateDashboardCache } from "../../shared/dashboard-cache.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import type { CompleteDonationPayload } from "./donation.interface.js";

const completionTransactionAttempts = 3;
const completionContentionCodes = new Set(["P2002", "P2034"]);
const completableRequestStatuses = new Set<BloodRequestStatus>([
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
]);

const completionAssignmentSelect = {
  id: true,
  bloodRequestId: true,
  donorId: true,
  status: true,
  invitedAt: true,
  respondedAt: true,
  reservation: {
    select: {
      id: true,
      donorId: true,
      bloodRequestId: true,
      expiresAt: true,
    },
  },
  donation: { select: { id: true } },
  donor: {
    select: {
      id: true,
      userId: true,
      totalDonationCount: true,
      lastDonationDate: true,
      isAvailable: true,
    },
  },
  bloodRequest: {
    select: {
      id: true,
      patientId: true,
      unitsRequired: true,
      unitsFulfilled: true,
      status: true,
      requiredAt: true,
      deletedAt: true,
      patient: { select: { userId: true } },
    },
  },
} satisfies Prisma.DonorAssignmentSelect;

const completionResultSelect = {
  id: true,
  assignmentId: true,
  bloodRequestId: true,
  donorId: true,
  patientId: true,
  unitCount: true,
  donatedAt: true,
  confirmedById: true,
  notes: true,
  createdAt: true,
  assignment: { select: { id: true, status: true } },
  bloodRequest: {
    select: {
      id: true,
      status: true,
      unitsRequired: true,
      unitsFulfilled: true,
      fulfilledAt: true,
    },
  },
  donor: {
    select: {
      id: true,
      totalDonationCount: true,
      lastDonationDate: true,
      isAvailable: true,
    },
  },
} satisfies Prisma.DonationSelect;

export const getCompletionRequestUpdate = (
  unitsRequired: number,
  unitsFulfilled: number,
  unitCount: number,
  completedAt: Date,
) => {
  const nextUnitsFulfilled = unitsFulfilled + unitCount;
  if (nextUnitsFulfilled > unitsRequired) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Donation would exceed the request's required units",
    );
  }

  const fulfilled = nextUnitsFulfilled === unitsRequired;
  return {
    nextUnitsFulfilled,
    status: fulfilled
      ? BloodRequestStatus.FULFILLED
      : BloodRequestStatus.PARTIALLY_FULFILLED,
    fulfilledAt: fulfilled ? completedAt : null,
  };
};

export const assertDonationTimeline = (
  donatedAt: Date,
  assignmentRespondedAt: Date | null,
  assignmentInvitedAt: Date,
  donorLastDonationDate: Date | null,
) => {
  const acceptedAt = assignmentRespondedAt ?? assignmentInvitedAt;
  if (donatedAt < acceptedAt) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Donation time cannot precede assignment acceptance",
    );
  }
  if (donorLastDonationDate && donatedAt < donorLastDonationDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Donation time cannot precede the donor's existing donation history",
    );
  }
};

const loadCompletion = (
  client: Pick<Prisma.TransactionClient, "donation">,
  assignmentId: number,
) =>
  client.donation.findUnique({
    where: { assignmentId },
    select: completionResultSelect,
  });

const loadPendingCompletionOutbox = async (
  client: Pick<Prisma.TransactionClient, "notification" | "outboxEvent">,
  assignmentId: number,
  bloodRequestId: number,
) => {
  const notifications = await client.notification.findMany({
    where: {
      bloodRequestId,
      OR: [
        { deduplicationKey: `donation-completed:${assignmentId}:donor` },
        { deduplicationKey: `donation-completed:${assignmentId}:patient` },
        {
          deduplicationKey: {
            startsWith: `request-fulfilled:${bloodRequestId}:assignment:`,
          },
        },
      ],
    },
    select: { id: true },
  });

  return client.outboxEvent.findMany({
    where: {
      deduplicationKey: {
        in: notifications.map(
          (notification) => `email-notification:${notification.id}`,
        ),
      },
      processedAt: null,
    },
    select: { id: true },
  });
};

const loadAssignmentOrThrow = async (
  transaction: Prisma.TransactionClient,
  assignmentId: number,
) => {
  const assignment = await transaction.donorAssignment.findUnique({
    where: { id: assignmentId },
    select: completionAssignmentSelect,
  });

  if (!assignment) {
    throw new AppError(httpStatus.NOT_FOUND, "Donor assignment not found");
  }

  return assignment;
};

const assertCompletableAssignment = (
  assignment: Prisma.DonorAssignmentGetPayload<{
    select: typeof completionAssignmentSelect;
  }>,
  now: Date,
) => {
  if (assignment.status !== AssignmentStatus.ACCEPTED) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Assignments in ${assignment.status} status cannot be completed`,
    );
  }
  if (
    !assignment.reservation ||
    assignment.reservation.donorId !== assignment.donorId ||
    assignment.reservation.bloodRequestId !== assignment.bloodRequestId
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Accepted assignment does not have a valid reservation",
    );
  }
  if (assignment.reservation.expiresAt <= now) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Accepted assignment reservation has expired",
    );
  }

  const request = assignment.bloodRequest;
  if (
    request.deletedAt ||
    !completableRequestStatuses.has(request.status) ||
    request.requiredAt <= now
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Blood request is no longer eligible for donation completion",
    );
  }
  if (request.unitsFulfilled >= request.unitsRequired) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Blood request is already fulfilled",
    );
  }
};

const createCompletionNotifications = async (
  transaction: Prisma.TransactionClient,
  assignment: Prisma.DonorAssignmentGetPayload<{
    select: typeof completionAssignmentSelect;
  }>,
  cancelledAssignments: readonly { id: number; donor: { userId: number } }[],
  requestStatus: BloodRequestStatus,
) => {
  const notificationData = [
    {
      userId: assignment.donor.userId,
      bloodRequestId: assignment.bloodRequestId,
      donorAssignmentId: assignment.id,
      title: "Donation recorded",
      message: "Your completed donation has been recorded successfully.",
      type: NotificationType.DONATION_COMPLETED,
      deduplicationKey: `donation-completed:${assignment.id}:donor`,
    },
    {
      userId: assignment.bloodRequest.patient.userId,
      bloodRequestId: assignment.bloodRequestId,
      donorAssignmentId: assignment.id,
      title:
        requestStatus === BloodRequestStatus.FULFILLED
          ? "Blood request fulfilled"
          : "Donation received",
      message:
        requestStatus === BloodRequestStatus.FULFILLED
          ? "The required donation units have been recorded and your request is fulfilled."
          : "A completed donation has been recorded for your blood request.",
      type: NotificationType.DONATION_COMPLETED,
      deduplicationKey: `donation-completed:${assignment.id}:patient`,
    },
    ...cancelledAssignments.map((cancelledAssignment) => ({
      userId: cancelledAssignment.donor.userId,
      bloodRequestId: assignment.bloodRequestId,
      donorAssignmentId: cancelledAssignment.id,
      title: "Donation assignment closed",
      message:
        "This blood request has been fulfilled, so your remaining assignment was closed.",
      type: NotificationType.SYSTEM,
      deduplicationKey: `request-fulfilled:${assignment.bloodRequestId}:assignment:${cancelledAssignment.id}`,
    })),
  ];

  await transaction.notification.createMany({
    data: notificationData,
    skipDuplicates: true,
  });
  const notifications = await transaction.notification.findMany({
    where: {
      deduplicationKey: {
        in: notificationData.map(({ deduplicationKey }) => deduplicationKey),
      },
    },
    select: { id: true },
  });
  if (notifications.length > 0) {
    await transaction.outboxEvent.createMany({
      data: notifications.map((notification) => ({
        type: "SEND_NOTIFICATION_EMAIL",
        aggregateId: String(notification.id),
        deduplicationKey: `email-notification:${notification.id}`,
        payload: { notificationId: notification.id },
      })),
      skipDuplicates: true,
    });
  }

  return transaction.outboxEvent.findMany({
    where: {
      deduplicationKey: {
        in: notifications.map(
          (notification) => `email-notification:${notification.id}`,
        ),
      },
      processedAt: null,
    },
    select: { id: true },
  });
};

const completeDonationOnce = (
  adminId: number,
  assignmentId: number,
  payload: CompleteDonationPayload,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      const now = new Date();
      const assignment = await loadAssignmentOrThrow(transaction, assignmentId);
      if (assignment.donation) {
        const existing = await loadCompletion(transaction, assignmentId);
        if (!existing) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Donation completion state is inconsistent",
          );
        }
        const outboxEvents = await loadPendingCompletionOutbox(
          transaction,
          assignmentId,
          assignment.bloodRequestId,
        );
        return {
          donation: existing,
          alreadyCompleted: true,
          outboxEventIds: outboxEvents.map(({ id }) => id),
        };
      }

      assertCompletableAssignment(assignment, now);
      const donatedAt = payload.donatedAt ?? now;
      assertDonationTimeline(
        donatedAt,
        assignment.respondedAt,
        assignment.invitedAt,
        assignment.donor.lastDonationDate,
      );
      const requestUpdate = getCompletionRequestUpdate(
        assignment.bloodRequest.unitsRequired,
        assignment.bloodRequest.unitsFulfilled,
        payload.unitCount,
        now,
      );

      await transaction.donation.create({
        data: {
          assignmentId: assignment.id,
          bloodRequestId: assignment.bloodRequestId,
          donorId: assignment.donorId,
          patientId: assignment.bloodRequest.patientId,
          unitCount: payload.unitCount,
          donatedAt,
          confirmedById: adminId,
          notes: payload.notes,
        },
        select: { id: true },
      });

      const donorUpdate = await transaction.donorProfile.updateMany({
        where: {
          id: assignment.donorId,
          totalDonationCount: assignment.donor.totalDonationCount,
        },
        data: {
          totalDonationCount: { increment: 1 },
          lastDonationDate: donatedAt,
          isAvailable: false,
        },
      });
      if (donorUpdate.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor changed while the donation was being completed",
        );
      }

      const patientUpdate = await transaction.patientProfile.updateMany({
        where: { id: assignment.bloodRequest.patientId },
        data: { totalReceivedCount: { increment: payload.unitCount } },
      });
      if (patientUpdate.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donation recipient is no longer available",
        );
      }

      const requestTransition = await transaction.bloodRequest.updateMany({
        where: {
          id: assignment.bloodRequestId,
          status: assignment.bloodRequest.status,
          unitsFulfilled: assignment.bloodRequest.unitsFulfilled,
          deletedAt: null,
        },
        data: {
          unitsFulfilled: requestUpdate.nextUnitsFulfilled,
          status: requestUpdate.status,
          fulfilledAt: requestUpdate.fulfilledAt,
        },
      });
      if (requestTransition.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Blood request changed while the donation was being completed",
        );
      }

      const assignmentTransition = await transaction.donorAssignment.updateMany(
        {
          where: {
            id: assignment.id,
            donorId: assignment.donorId,
            bloodRequestId: assignment.bloodRequestId,
            status: AssignmentStatus.ACCEPTED,
          },
          data: { status: AssignmentStatus.COMPLETED },
        },
      );
      if (assignmentTransition.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Assignment changed while the donation was being completed",
        );
      }

      const cancelledAssignments =
        requestUpdate.status === BloodRequestStatus.FULFILLED
          ? await transaction.donorAssignment.findMany({
              where: {
                bloodRequestId: assignment.bloodRequestId,
                id: { not: assignment.id },
                status: {
                  in: [AssignmentStatus.INVITED, AssignmentStatus.ACCEPTED],
                },
              },
              select: {
                id: true,
                donor: { select: { userId: true } },
              },
            })
          : [];

      if (cancelledAssignments.length > 0) {
        const cancelledIds = cancelledAssignments.map(({ id }) => id);
        await transaction.donorAssignment.updateMany({
          where: {
            id: { in: cancelledIds },
            status: {
              in: [AssignmentStatus.INVITED, AssignmentStatus.ACCEPTED],
            },
          },
          data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
        });
        await transaction.notification.updateMany({
          where: {
            donorAssignmentId: { in: cancelledIds },
            type: NotificationType.DONOR_INVITATION,
            deliveryStatus: NotificationDeliveryStatus.PENDING,
          },
          data: { deliveryStatus: NotificationDeliveryStatus.FAILED },
        });
      }

      await transaction.donorReservation.deleteMany({
        where:
          requestUpdate.status === BloodRequestStatus.FULFILLED
            ? { bloodRequestId: assignment.bloodRequestId }
            : { id: assignment.reservation!.id },
      });

      const outboxEvents = await createCompletionNotifications(
        transaction,
        assignment,
        cancelledAssignments,
        requestUpdate.status,
      );
      const donation = await loadCompletion(transaction, assignment.id);
      if (!donation) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donation completion could not be reloaded",
        );
      }

      await recordAuditEvent(
        {
          actorId: adminId,
          action: "DONATION_COMPLETED",
          entityType: "Donation",
          entityId: String(donation.id),
          before: {
            assignmentStatus: assignment.status,
            requestStatus: assignment.bloodRequest.status,
            unitsFulfilled: assignment.bloodRequest.unitsFulfilled,
            donorTotalDonationCount: assignment.donor.totalDonationCount,
            donorAvailable: assignment.donor.isAvailable,
          },
          after: {
            assignmentStatus: AssignmentStatus.COMPLETED,
            requestStatus: donation.bloodRequest.status,
            unitsFulfilled: donation.bloodRequest.unitsFulfilled,
            donorTotalDonationCount: donation.donor.totalDonationCount,
            donorAvailable: donation.donor.isAvailable,
            donationId: donation.id,
            unitCount: donation.unitCount,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );

      return {
        donation,
        alreadyCompleted: false,
        outboxEventIds: outboxEvents.map(({ id }) => id),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

const isCompletionContentionError = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  completionContentionCodes.has(error.code);

const publishCompletionOutbox = async (
  assignmentId: number,
  outboxEventIds: readonly number[],
) => {
  if (outboxEventIds.length === 0) return false;

  try {
    const publication = await publishPendingOutboxEvents({
      ids: outboxEventIds,
    });
    return publication.deferred > 0;
  } catch {
    console.error("Post-commit donation outbox publication was deferred", {
      assignmentId,
      eventCount: outboxEventIds.length,
    });
    return true;
  }
};

const completeDonation = async (
  adminId: number,
  assignmentId: number,
  payload: CompleteDonationPayload,
  context: TRequestContext,
) => {
  for (
    let attempt = 1;
    attempt <= completionTransactionAttempts;
    attempt += 1
  ) {
    try {
      const result = await completeDonationOnce(
        adminId,
        assignmentId,
        payload,
        context,
      );
      const queuePublicationDeferred = await publishCompletionOutbox(
        assignmentId,
        result.outboxEventIds,
      );
      await invalidateDashboardCache();
      return {
        ...result.donation,
        alreadyCompleted: result.alreadyCompleted,
        queuePublicationDeferred,
      };
    } catch (error) {
      if (!isCompletionContentionError(error)) throw error;
      if (attempt < completionTransactionAttempts) continue;

      const existing = await loadCompletion(prisma, assignmentId);
      if (existing) {
        const outboxEvents = await loadPendingCompletionOutbox(
          prisma,
          assignmentId,
          existing.bloodRequestId,
        );
        const queuePublicationDeferred = await publishCompletionOutbox(
          assignmentId,
          outboxEvents.map(({ id }) => id),
        );
        await invalidateDashboardCache();
        return {
          ...existing,
          alreadyCompleted: true,
          queuePublicationDeferred,
        };
      }
      throw new AppError(
        httpStatus.CONFLICT,
        "Donation could not be completed due to concurrent changes",
      );
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "Donation could not be completed due to concurrent changes",
  );
};

export const donationService = { completeDonation };
