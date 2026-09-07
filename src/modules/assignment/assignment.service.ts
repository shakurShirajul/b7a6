import httpStatus from "http-status";
import config from "../../config/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  AssignmentStatus,
  BloodRequestStatus,
  NotificationType,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { publishPendingOutboxEvents } from "../../jobs/queue.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { lockVerifiedHospitalForRequest } from "../../shared/hospital-lock.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import { evaluateDonorEligibility } from "../donor/donor.eligibility.js";
import type {
  AssignmentListQuery,
  RejectAssignmentPayload,
} from "./assignment.interface.js";

const assignmentTransactionAttempts = 3;
const contentionCodes = new Set(["P2002", "P2034"]);

const donorEligibilityPolicy = {
  minAgeYears: config.donor_policy.min_age_years,
  maxAgeYears: config.donor_policy.max_age_years,
  minWeightKg: config.donor_policy.min_weight_kg,
  minDonationIntervalDays: config.donor_policy.min_donation_interval_days,
};

const actionableRequestStatuses = new Set<BloodRequestStatus>([
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
]);

const assignmentListSelect = {
  id: true,
  status: true,
  score: true,
  distanceKm: true,
  matchReason: true,
  invitedAt: true,
  expiresAt: true,
  respondedAt: true,
  reservation: {
    select: { expiresAt: true },
  },
  bloodRequest: {
    select: {
      id: true,
      bloodType: true,
      unitsRequired: true,
      unitsFulfilled: true,
      urgency: true,
      status: true,
      description: true,
      requiredAt: true,
      division: true,
      district: true,
      area: true,
      hospital: {
        select: {
          id: true,
          name: true,
          address: true,
          contactPhone: true,
          division: true,
          district: true,
          area: true,
        },
      },
    },
  },
} satisfies Prisma.DonorAssignmentSelect;

const acceptanceSelect = {
  id: true,
  bloodRequestId: true,
  donorId: true,
  status: true,
  expiresAt: true,
  respondedAt: true,
  donor: {
    select: {
      id: true,
      userId: true,
      bloodType: true,
      isAvailable: true,
      verificationStatus: true,
      weightKg: true,
      lastDonationDate: true,
      user: {
        select: {
          id: true,
          status: true,
          deletedAt: true,
          dateOfBirth: true,
        },
      },
      eligibilityAssessments: {
        orderBy: [{ checkedAt: "desc" as const }, { id: "desc" as const }],
        take: 1,
        select: {
          isEligible: true,
          checkedAt: true,
          expiresAt: true,
        },
      },
      reservation: {
        select: {
          id: true,
          assignmentId: true,
          bloodRequestId: true,
          expiresAt: true,
        },
      },
    },
  },
  bloodRequest: {
    select: {
      id: true,
      patientId: true,
      hospitalId: true,
      bloodType: true,
      unitsRequired: true,
      unitsFulfilled: true,
      status: true,
      requiredAt: true,
      deletedAt: true,
      patient: { select: { userId: true } },
    },
  },
} satisfies Prisma.DonorAssignmentSelect;

const getDonorProfileIdOrThrow = async (userId: number) => {
  const donor = await prisma.donorProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!donor) {
    throw new AppError(httpStatus.NOT_FOUND, "Donor profile not found");
  }

  return donor.id;
};

const listMyAssignments = async (
  userId: number,
  query: AssignmentListQuery,
) => {
  const donorId = await getDonorProfileIdOrThrow(userId);
  const where = {
    donorId,
    ...(query.status ? { status: query.status } : {}),
  } satisfies Prisma.DonorAssignmentWhereInput;
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.donorAssignment.findMany({
      where,
      select: assignmentListSelect,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.donorAssignment.count({ where }),
  ]);

  return {
    data,
    meta: { page: query.page, limit: query.limit, total },
  };
};

export const getRemainingAcceptanceCapacity = (
  unitsRequired: number,
  unitsFulfilled: number,
  outstandingReservedUnits: number,
) => Math.max(0, unitsRequired - unitsFulfilled - outstandingReservedUnits);

const publishCommittedOutboxEvents = async (
  outboxEventIds: readonly number[],
  operation: string,
  assignmentId: number,
) => {
  if (outboxEventIds.length === 0) return false;

  try {
    const publication = await publishPendingOutboxEvents({
      ids: outboxEventIds,
    });
    return publication.deferred > 0;
  } catch {
    console.error(`Post-commit ${operation} outbox publication was deferred`, {
      assignmentId,
      eventCount: outboxEventIds.length,
    });
    return true;
  }
};

const isContentionError = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  contentionCodes.has(error.code);

const assertOwnedAssignment = (
  assignment: Prisma.DonorAssignmentGetPayload<{
    select: typeof acceptanceSelect;
  }>,
  userId: number,
) => {
  if (assignment.donor.userId !== userId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You do not have permission to respond to this assignment",
    );
  }
};

const assertInvitedAssignment = (
  assignment: Prisma.DonorAssignmentGetPayload<{
    select: typeof acceptanceSelect;
  }>,
  now: Date,
) => {
  if (assignment.status !== AssignmentStatus.INVITED) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Assignments in ${assignment.status} status cannot be accepted or rejected`,
    );
  }
  if (assignment.expiresAt <= now) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Assignment invitation has expired",
    );
  }
};

const assertActionableRequest = (
  request: Prisma.DonorAssignmentGetPayload<{
    select: typeof acceptanceSelect;
  }>["bloodRequest"],
  now: Date,
) => {
  if (
    request.deletedAt ||
    !actionableRequestStatuses.has(request.status) ||
    request.requiredAt <= now
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Blood request is no longer accepting donor responses",
    );
  }
};

const loadAssignmentOrThrow = async (
  transaction: Prisma.TransactionClient,
  assignmentId: number,
) => {
  const assignment = await transaction.donorAssignment.findUnique({
    where: { id: assignmentId },
    select: acceptanceSelect,
  });

  if (!assignment) {
    throw new AppError(httpStatus.NOT_FOUND, "Donor assignment not found");
  }

  return assignment;
};

const createNotificationOutboxEvents = async (
  transaction: Prisma.TransactionClient,
  deduplicationKeys: readonly string[],
) => {
  const notifications = await transaction.notification.findMany({
    where: { deduplicationKey: { in: [...deduplicationKeys] } },
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

const acceptAssignmentOnce = (
  userId: number,
  assignmentId: number,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      const now = new Date();
      const assignment = await loadAssignmentOrThrow(transaction, assignmentId);
      assertOwnedAssignment(assignment, userId);
      assertInvitedAssignment(assignment, now);
      assertActionableRequest(assignment.bloodRequest, now);

      await lockVerifiedHospitalForRequest(
        transaction,
        assignment.bloodRequest.hospitalId,
      );

      const staleReservation =
        assignment.donor.reservation &&
        assignment.donor.reservation.expiresAt <= now
          ? assignment.donor.reservation
          : null;
      if (staleReservation) {
        await transaction.donorAssignment.updateMany({
          where: {
            id: staleReservation.assignmentId,
            status: AssignmentStatus.ACCEPTED,
          },
          data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
        });
        await transaction.donorReservation.deleteMany({
          where: { id: staleReservation.id, expiresAt: { lte: now } },
        });
      }

      const outstandingReservedUnits = await transaction.donorReservation.count(
        {
          where: {
            bloodRequestId: assignment.bloodRequestId,
            expiresAt: { gt: now },
          },
        },
      );
      if (
        getRemainingAcceptanceCapacity(
          assignment.bloodRequest.unitsRequired,
          assignment.bloodRequest.unitsFulfilled,
          outstandingReservedUnits,
        ) < 1
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Blood request has no unreserved units remaining",
        );
      }

      const latestAssessment =
        assignment.donor.eligibilityAssessments[0] ?? null;
      const eligibility = evaluateDonorEligibility(
        {
          userStatus: assignment.donor.user.status,
          userDeletedAt: assignment.donor.user.deletedAt,
          dateOfBirth: assignment.donor.user.dateOfBirth,
          verificationStatus: assignment.donor.verificationStatus,
          isAvailable: assignment.donor.isAvailable,
          bloodType: assignment.donor.bloodType,
          weightKg: Number(assignment.donor.weightKg),
          lastDonationDate: assignment.donor.lastDonationDate,
          latestAssessment,
          reservationExpiresAt: staleReservation
            ? null
            : (assignment.donor.reservation?.expiresAt ?? null),
          requestContext: {
            recipientBloodType: assignment.bloodRequest.bloodType,
            assignmentStatus: null,
          },
        },
        donorEligibilityPolicy,
        now,
      );
      if (!eligibility.isEligible) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor is no longer eligible to accept this assignment",
          eligibility.reasonCodes.map((reasonCode) => ({
            path: "eligibility",
            message: reasonCode,
          })),
        );
      }

      const reservation = await transaction.donorReservation.create({
        data: {
          donorId: assignment.donorId,
          assignmentId: assignment.id,
          bloodRequestId: assignment.bloodRequestId,
          expiresAt: assignment.bloodRequest.requiredAt,
        },
        select: { id: true, expiresAt: true },
      });
      const transitioned = await transaction.donorAssignment.updateMany({
        where: {
          id: assignment.id,
          donorId: assignment.donorId,
          status: AssignmentStatus.INVITED,
          expiresAt: { gt: now },
        },
        data: { status: AssignmentStatus.ACCEPTED, respondedAt: now },
      });
      if (transitioned.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Assignment changed while it was being accepted",
        );
      }

      const notificationKeys = [
        `assignment-accepted:${assignment.id}:donor`,
        `assignment-accepted:${assignment.id}:patient`,
      ];
      await transaction.notification.createMany({
        data: [
          {
            userId: assignment.donor.userId,
            bloodRequestId: assignment.bloodRequestId,
            donorAssignmentId: assignment.id,
            title: "Donation commitment confirmed",
            message:
              "Your donation commitment is confirmed. The hospital details remain available in your assignment.",
            type: NotificationType.REQUEST_ACCEPTED,
            deduplicationKey: notificationKeys[0]!,
          },
          {
            userId: assignment.bloodRequest.patient.userId,
            bloodRequestId: assignment.bloodRequestId,
            donorAssignmentId: assignment.id,
            title: "A donor accepted your request",
            message:
              "A compatible donor accepted an invitation for your blood request.",
            type: NotificationType.REQUEST_ACCEPTED,
            deduplicationKey: notificationKeys[1]!,
          },
        ],
        skipDuplicates: true,
      });
      const outboxEvents = await createNotificationOutboxEvents(
        transaction,
        notificationKeys,
      );

      await recordAuditEvent(
        {
          actorId: userId,
          action: "DONOR_ASSIGNMENT_ACCEPTED",
          entityType: "DonorAssignment",
          entityId: String(assignment.id),
          before: {
            status: assignment.status,
            respondedAt: assignment.respondedAt?.toISOString() ?? null,
          },
          after: {
            status: AssignmentStatus.ACCEPTED,
            respondedAt: now.toISOString(),
            reservationId: reservation.id,
            reservationExpiresAt: reservation.expiresAt.toISOString(),
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );

      const result = await transaction.donorAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
        select: assignmentListSelect,
      });
      return {
        assignment: result,
        outboxEventIds: outboxEvents.map(({ id }) => id),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

const acceptAssignment = async (
  userId: number,
  assignmentId: number,
  context: TRequestContext,
) => {
  for (
    let attempt = 1;
    attempt <= assignmentTransactionAttempts;
    attempt += 1
  ) {
    try {
      const result = await acceptAssignmentOnce(userId, assignmentId, context);
      const queuePublicationDeferred = await publishCommittedOutboxEvents(
        result.outboxEventIds,
        "assignment acceptance",
        assignmentId,
      );
      return { ...result.assignment, queuePublicationDeferred };
    } catch (error) {
      if (!isContentionError(error)) throw error;
      if (error.code === "P2034" && attempt < assignmentTransactionAttempts) {
        continue;
      }
      throw new AppError(
        httpStatus.CONFLICT,
        "Assignment could not be accepted because its availability changed",
      );
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "Assignment could not be accepted due to concurrent changes",
  );
};

const rejectAssignment = async (
  userId: number,
  assignmentId: number,
  payload: RejectAssignmentPayload,
  context: TRequestContext,
) => {
  const result = await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const assignment = await loadAssignmentOrThrow(transaction, assignmentId);
    assertOwnedAssignment(assignment, userId);
    assertInvitedAssignment(assignment, now);
    assertActionableRequest(assignment.bloodRequest, now);

    const transitioned = await transaction.donorAssignment.updateMany({
      where: {
        id: assignment.id,
        donorId: assignment.donorId,
        status: AssignmentStatus.INVITED,
        expiresAt: { gt: now },
      },
      data: { status: AssignmentStatus.DECLINED, respondedAt: now },
    });
    if (transitioned.count !== 1) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Assignment changed while it was being rejected",
      );
    }

    const notificationKey = `assignment-declined:${assignment.id}:patient`;
    await transaction.notification.create({
      data: {
        userId: assignment.bloodRequest.patient.userId,
        bloodRequestId: assignment.bloodRequestId,
        donorAssignmentId: assignment.id,
        title: "A donor declined an invitation",
        message:
          "A donor declined an invitation. Matching can continue with other eligible donors.",
        type: NotificationType.REQUEST_REJECTED,
        deduplicationKey: notificationKey,
      },
    });
    const outboxEvents = await createNotificationOutboxEvents(transaction, [
      notificationKey,
    ]);

    await recordAuditEvent(
      {
        actorId: userId,
        action: "DONOR_ASSIGNMENT_DECLINED",
        entityType: "DonorAssignment",
        entityId: String(assignment.id),
        before: {
          status: assignment.status,
          respondedAt: assignment.respondedAt?.toISOString() ?? null,
        },
        after: {
          status: AssignmentStatus.DECLINED,
          respondedAt: now.toISOString(),
          reasonCode: payload.reasonCode,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    const updated = await transaction.donorAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
      select: assignmentListSelect,
    });
    return {
      assignment: updated,
      reasonCode: payload.reasonCode,
      outboxEventIds: outboxEvents.map(({ id }) => id),
    };
  });

  const queuePublicationDeferred = await publishCommittedOutboxEvents(
    result.outboxEventIds,
    "assignment rejection",
    assignmentId,
  );
  return {
    ...result.assignment,
    reasonCode: result.reasonCode,
    queuePublicationDeferred,
  };
};

export const assignmentService = {
  listMyAssignments,
  acceptAssignment,
  rejectAssignment,
};
