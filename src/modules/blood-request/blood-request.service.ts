import httpStatus from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import {
  AssignmentStatus,
  BloodRequestStatus,
  Role,
  VerificationStatus,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { invalidateDashboardCache } from "../../shared/dashboard-cache.js";
import { lockVerifiedHospitalForRequest } from "../../shared/hospital-lock.js";
import { dispatchVerifiedRequestMatching } from "../matching/dispatch.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import type {
  BloodRequestListQuery,
  CreateBloodRequestPayload,
  CurrentBloodRequestUser,
  UpdateBloodRequestPayload,
  VerifyBloodRequestPayload,
} from "./blood-request.interface.js";

const publicRequestSelect = {
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BloodRequestSelect;

const requestDetailSelect = {
  ...publicRequestSelect,
  patientId: true,
  hospitalId: true,
  proofUrl: true,
  latitude: true,
  longitude: true,
  verifiedAt: true,
  fulfilledAt: true,
  patient: {
    select: {
      id: true,
      bloodType: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  },
} satisfies Prisma.BloodRequestSelect;

const statusTransitions: Readonly<
  Record<BloodRequestStatus, readonly BloodRequestStatus[]>
> = {
  [BloodRequestStatus.PENDING_VERIFICATION]: [
    BloodRequestStatus.VERIFIED,
    BloodRequestStatus.REJECTED,
    BloodRequestStatus.CANCELLED,
  ],
  [BloodRequestStatus.VERIFIED]: [
    BloodRequestStatus.MATCHING,
    BloodRequestStatus.CANCELLED,
    BloodRequestStatus.EXPIRED,
  ],
  [BloodRequestStatus.MATCHING]: [
    BloodRequestStatus.PARTIALLY_FULFILLED,
    BloodRequestStatus.FULFILLED,
    BloodRequestStatus.CANCELLED,
    BloodRequestStatus.EXPIRED,
  ],
  [BloodRequestStatus.PARTIALLY_FULFILLED]: [
    BloodRequestStatus.MATCHING,
    BloodRequestStatus.FULFILLED,
    BloodRequestStatus.CANCELLED,
    BloodRequestStatus.EXPIRED,
  ],
  [BloodRequestStatus.FULFILLED]: [],
  [BloodRequestStatus.REJECTED]: [],
  [BloodRequestStatus.CANCELLED]: [],
  [BloodRequestStatus.EXPIRED]: [],
};

export const assertBloodRequestTransition = (
  from: BloodRequestStatus,
  to: BloodRequestStatus,
) => {
  if (!statusTransitions[from].includes(to)) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Blood request cannot transition from ${from} to ${to}`,
    );
  }
};

const deletionStatuses = new Set<BloodRequestStatus>([
  BloodRequestStatus.PENDING_VERIFICATION,
  BloodRequestStatus.REJECTED,
  BloodRequestStatus.CANCELLED,
  BloodRequestStatus.EXPIRED,
]);

const activeAssignmentStatuses = [
  AssignmentStatus.INVITED,
  AssignmentStatus.ACCEPTED,
] as const;

const publiclyVisibleStatuses = [
  BloodRequestStatus.VERIFIED,
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
] as const;

const getPatientProfileOrThrow = async (
  client: Pick<Prisma.TransactionClient, "patientProfile">,
  userId: number,
) => {
  const profile = await client.patientProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient profile not found");
  }

  return profile;
};

const requestAuditProjection = (request: {
  id: number;
  patientId: number;
  hospitalId: number;
  bloodType: string;
  unitsRequired: number;
  unitsFulfilled: number;
  urgency: string;
  status: string;
  requiredAt: Date;
  deletedAt?: Date | null;
}) => ({
  id: request.id,
  patientId: request.patientId,
  hospitalId: request.hospitalId,
  bloodType: request.bloodType,
  unitsRequired: request.unitsRequired,
  unitsFulfilled: request.unitsFulfilled,
  urgency: request.urgency,
  status: request.status,
  requiredAt: request.requiredAt.toISOString(),
  deletedAt: request.deletedAt?.toISOString() ?? null,
});

const requestCreationTransactionAttempts = 3;

const createBloodRequestOnce = (
  userId: number,
  payload: CreateBloodRequestPayload,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      const patient = await getPatientProfileOrThrow(transaction, userId);
      await lockVerifiedHospitalForRequest(transaction, payload.hospitalId);

      const request = await transaction.bloodRequest.create({
        data: {
          ...payload,
          patientId: patient.id,
          unitsFulfilled: 0,
          status: BloodRequestStatus.PENDING_VERIFICATION,
        },
        select: requestDetailSelect,
      });

      await recordAuditEvent(
        {
          actorId: userId,
          action: "BLOOD_REQUEST_CREATED",
          entityType: "BloodRequest",
          entityId: String(request.id),
          after: requestAuditProjection(request),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );

      return request;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

const createBloodRequest = async (
  userId: number,
  payload: CreateBloodRequestPayload,
  context: TRequestContext,
) => {
  for (
    let attempt = 1;
    attempt <= requestCreationTransactionAttempts;
    attempt += 1
  ) {
    try {
      const request = await createBloodRequestOnce(userId, payload, context);
      await invalidateDashboardCache();
      return request;
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable) throw error;
      if (attempt === requestCreationTransactionAttempts) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Blood request could not be created due to a concurrent hospital change",
        );
      }
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "Blood request could not be created due to a concurrent hospital change",
  );
};

const roleVisibilityWhere = async (
  user: CurrentBloodRequestUser,
): Promise<Prisma.BloodRequestWhereInput> => {
  if (user.role === Role.ADMIN) return {};

  if (user.role === Role.PATIENT) {
    const profile = await getPatientProfileOrThrow(prisma, user.userId);
    return {
      OR: [
        { patientId: profile.id },
        { status: { in: [...publiclyVisibleStatuses] } },
      ],
    };
  }

  return {
    OR: [
      { status: { in: [...publiclyVisibleStatuses] } },
      { assignments: { some: { donor: { userId: user.userId } } } },
    ],
  };
};

const buildFilterWhere = (
  query: BloodRequestListQuery,
): Prisma.BloodRequestWhereInput => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.urgency ? { urgency: query.urgency } : {}),
  ...(query.bloodType ? { bloodType: query.bloodType } : {}),
  ...(query.hospitalId ? { hospitalId: query.hospitalId } : {}),
  ...(query.division
    ? { division: { equals: query.division, mode: "insensitive" } }
    : {}),
  ...(query.district
    ? { district: { equals: query.district, mode: "insensitive" } }
    : {}),
  ...(query.area ? { area: { equals: query.area, mode: "insensitive" } } : {}),
  ...(query.q
    ? {
        OR: [
          { description: { contains: query.q, mode: "insensitive" } },
          { division: { contains: query.q, mode: "insensitive" } },
          { district: { contains: query.q, mode: "insensitive" } },
          { area: { contains: query.q, mode: "insensitive" } },
          { hospital: { name: { contains: query.q, mode: "insensitive" } } },
        ],
      }
    : {}),
});

const getOrderBy = (
  query: BloodRequestListQuery,
): Prisma.BloodRequestOrderByWithRelationInput[] => {
  const primary: Prisma.BloodRequestOrderByWithRelationInput =
    query.sortBy === "requiredAt"
      ? { requiredAt: query.sortOrder }
      : query.sortBy === "updatedAt"
        ? { updatedAt: query.sortOrder }
        : query.sortBy === "unitsRequired"
          ? { unitsRequired: query.sortOrder }
          : { createdAt: query.sortOrder };

  return [primary, { id: "asc" }];
};

const listBloodRequests = async (
  user: CurrentBloodRequestUser,
  query: BloodRequestListQuery,
) => {
  const visibilityWhere = await roleVisibilityWhere(user);
  const where: Prisma.BloodRequestWhereInput = {
    AND: [{ deletedAt: null }, visibilityWhere, buildFilterWhere(query)],
  };
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.bloodRequest.findMany({
      where,
      select: publicRequestSelect,
      orderBy: getOrderBy(query),
      skip,
      take: query.limit,
    }),
    prisma.bloodRequest.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
};

const listMyBloodRequests = async (
  userId: number,
  query: BloodRequestListQuery,
) => {
  const profile = await getPatientProfileOrThrow(prisma, userId);
  const where: Prisma.BloodRequestWhereInput = {
    AND: [{ deletedAt: null, patientId: profile.id }, buildFilterWhere(query)],
  };
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.bloodRequest.findMany({
      where,
      select: requestDetailSelect,
      orderBy: getOrderBy(query),
      skip,
      take: query.limit,
    }),
    prisma.bloodRequest.count({ where }),
  ]);

  return { data, meta: { page: query.page, limit: query.limit, total } };
};

const getAuthorizedBloodRequest = async (
  user: CurrentBloodRequestUser,
  id: number,
) => {
  const roleWhere: Prisma.BloodRequestWhereInput =
    user.role === Role.ADMIN
      ? {}
      : user.role === Role.PATIENT
        ? { patient: { userId: user.userId } }
        : {
            assignments: {
              some: { donor: { userId: user.userId } },
            },
          };
  const request = await prisma.bloodRequest.findFirst({
    where: { id, deletedAt: null, ...roleWhere },
    select: requestDetailSelect,
  });

  if (!request) {
    const exists = await prisma.bloodRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    throw new AppError(
      exists ? httpStatus.FORBIDDEN : httpStatus.NOT_FOUND,
      exists
        ? "You do not have permission to access this blood request"
        : "Blood request not found",
    );
  }

  return request;
};

const getOwnedPendingRequest = async (userId: number, id: number) => {
  const request = await prisma.bloodRequest.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      hospitalId: true,
      bloodType: true,
      unitsRequired: true,
      unitsFulfilled: true,
      urgency: true,
      status: true,
      requiredAt: true,
      deletedAt: true,
      patient: { select: { userId: true } },
    },
  });

  if (!request) {
    throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
  }
  if (request.patient.userId !== userId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You do not have permission to modify this blood request",
    );
  }
  if (request.status !== BloodRequestStatus.PENDING_VERIFICATION) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Only pending blood requests can be edited",
    );
  }

  return request;
};

const updateBloodRequest = async (
  userId: number,
  id: number,
  payload: UpdateBloodRequestPayload,
  context: TRequestContext,
) => {
  const existing = await getOwnedPendingRequest(userId, id);

  const request = await prisma.$transaction(async (transaction) => {
    if (payload.hospitalId !== undefined) {
      await lockVerifiedHospitalForRequest(transaction, payload.hospitalId);
    }

    const updated = await transaction.bloodRequest.updateMany({
      where: {
        id,
        patientId: existing.patientId,
        status: BloodRequestStatus.PENDING_VERIFICATION,
        deletedAt: null,
      },
      data: payload,
    });

    if (updated.count !== 1) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Blood request is no longer editable",
      );
    }

    const result = await transaction.bloodRequest.findUniqueOrThrow({
      where: { id },
      select: requestDetailSelect,
    });
    await recordAuditEvent(
      {
        actorId: userId,
        action: "BLOOD_REQUEST_UPDATED",
        entityType: "BloodRequest",
        entityId: String(id),
        before: requestAuditProjection(existing),
        after: requestAuditProjection(result),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return result;
  });

  return request;
};

const deleteBloodRequest = async (
  user: CurrentBloodRequestUser,
  id: number,
  context: TRequestContext,
) => {
  const result = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.bloodRequest.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        bloodType: true,
        unitsRequired: true,
        unitsFulfilled: true,
        urgency: true,
        status: true,
        requiredAt: true,
        deletedAt: true,
        patient: { select: { userId: true } },
      },
    });

    if (!existing) {
      throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
    }
    if (user.role !== Role.ADMIN && existing.patient.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You do not have permission to delete this blood request",
      );
    }
    if (!deletionStatuses.has(existing.status)) {
      throw new AppError(
        httpStatus.CONFLICT,
        `Blood requests in ${existing.status} status cannot be deleted`,
      );
    }

    const deletedAt = new Date();
    const deleted = await transaction.bloodRequest.updateMany({
      where: { id, status: existing.status, deletedAt: null },
      data: { deletedAt },
    });
    if (deleted.count !== 1) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Blood request changed while it was being deleted",
      );
    }
    await recordAuditEvent(
      {
        actorId: user.userId,
        action: "BLOOD_REQUEST_DELETED",
        entityType: "BloodRequest",
        entityId: String(id),
        before: requestAuditProjection(existing),
        after: {
          ...requestAuditProjection(existing),
          deletedAt: deletedAt.toISOString(),
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return { id, status: existing.status, deletedAt };
  });
  await invalidateDashboardCache();
  return result;
};

const cancelBloodRequest = async (
  user: CurrentBloodRequestUser,
  id: number,
  context: TRequestContext,
) => {
  const request = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.bloodRequest.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        bloodType: true,
        unitsRequired: true,
        unitsFulfilled: true,
        urgency: true,
        status: true,
        requiredAt: true,
        deletedAt: true,
        patient: { select: { userId: true } },
      },
    });

    if (!existing) {
      throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
    }
    if (user.role !== Role.ADMIN && existing.patient.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You do not have permission to cancel this blood request",
      );
    }
    if (existing.status === BloodRequestStatus.CANCELLED) {
      return transaction.bloodRequest.findUniqueOrThrow({
        where: { id },
        select: requestDetailSelect,
      });
    }

    assertBloodRequestTransition(existing.status, BloodRequestStatus.CANCELLED);
    const updated = await transaction.bloodRequest.updateMany({
      where: { id, status: existing.status, deletedAt: null },
      data: { status: BloodRequestStatus.CANCELLED },
    });
    if (updated.count !== 1) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Blood request changed while it was being cancelled",
      );
    }

    await transaction.donorAssignment.updateMany({
      where: {
        bloodRequestId: id,
        status: { in: [...activeAssignmentStatuses] },
      },
      data: { status: AssignmentStatus.CANCELLED },
    });
    await transaction.donorReservation.deleteMany({
      where: { bloodRequestId: id },
    });

    const result = await transaction.bloodRequest.findUniqueOrThrow({
      where: { id },
      select: requestDetailSelect,
    });
    await recordAuditEvent(
      {
        actorId: user.userId,
        action: "BLOOD_REQUEST_CANCELLED",
        entityType: "BloodRequest",
        entityId: String(id),
        before: requestAuditProjection(existing),
        after: requestAuditProjection(result),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return result;
  });
  await invalidateDashboardCache();
  return request;
};

const VERIFICATION_TRANSACTION_ATTEMPTS = 3;

const verifyBloodRequestOnce = (
  adminId: number,
  id: number,
  payload: VerifyBloodRequestPayload,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      const existing = await transaction.bloodRequest.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          patientId: true,
          hospitalId: true,
          bloodType: true,
          unitsRequired: true,
          unitsFulfilled: true,
          urgency: true,
          status: true,
          requiredAt: true,
          deletedAt: true,
          hospital: {
            select: { verificationStatus: true, deletedAt: true },
          },
          verifications: {
            where: { decision: payload.decision },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!existing) {
        throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
      }
      if (existing.verifications.length > 0) {
        return transaction.bloodRequest.findUniqueOrThrow({
          where: { id },
          select: requestDetailSelect,
        });
      }
      if (existing.status !== BloodRequestStatus.PENDING_VERIFICATION) {
        throw new AppError(
          httpStatus.CONFLICT,
          `Blood requests in ${existing.status} status cannot be verified or rejected`,
        );
      }
      await lockVerifiedHospitalForRequest(transaction, existing.hospitalId);
      if (
        existing.hospital.verificationStatus !== VerificationStatus.VERIFIED ||
        existing.hospital.deletedAt
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "The request hospital must remain verified and active",
        );
      }

      const targetStatus =
        payload.decision === VerificationStatus.VERIFIED
          ? BloodRequestStatus.VERIFIED
          : BloodRequestStatus.REJECTED;
      assertBloodRequestTransition(existing.status, targetStatus);
      const now = new Date();
      const updated = await transaction.bloodRequest.updateMany({
        where: {
          id,
          status: BloodRequestStatus.PENDING_VERIFICATION,
          deletedAt: null,
        },
        data: {
          status: targetStatus,
          verifiedAt:
            payload.decision === VerificationStatus.VERIFIED ? now : null,
          verifiedById:
            payload.decision === VerificationStatus.VERIFIED ? adminId : null,
        },
      });
      if (updated.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Blood request changed while it was being reviewed",
        );
      }

      await transaction.requestVerification.create({
        data: {
          bloodRequestId: id,
          adminId,
          decision: payload.decision,
          reasonCode: payload.reasonCode,
        },
      });
      if (payload.decision === VerificationStatus.VERIFIED) {
        await transaction.outboxEvent.create({
          data: {
            type: "MATCH_BLOOD_REQUEST",
            aggregateId: String(id),
            payload: {
              bloodRequestId: id,
              urgency: existing.urgency,
              requiredAt: existing.requiredAt.toISOString(),
            },
          },
        });
      }

      const result = await transaction.bloodRequest.findUniqueOrThrow({
        where: { id },
        select: requestDetailSelect,
      });
      await recordAuditEvent(
        {
          actorId: adminId,
          action:
            payload.decision === VerificationStatus.VERIFIED
              ? "BLOOD_REQUEST_VERIFIED"
              : "BLOOD_REQUEST_REJECTED",
          entityType: "BloodRequest",
          entityId: String(id),
          before: requestAuditProjection(existing),
          after: requestAuditProjection(result),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

const verifyBloodRequest = async (
  adminId: number,
  id: number,
  payload: VerifyBloodRequestPayload,
  context: TRequestContext,
) => {
  let request: Awaited<ReturnType<typeof verifyBloodRequestOnce>> | undefined;
  for (
    let attempt = 1;
    attempt <= VERIFICATION_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      request = await verifyBloodRequestOnce(adminId, id, payload, context);
      break;
    } catch (error) {
      const shouldRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < VERIFICATION_TRANSACTION_ATTEMPTS;
      if (!shouldRetry) throw error;
    }
  }

  if (!request) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Blood request review could not be completed due to contention",
    );
  }
  await invalidateDashboardCache();
  if (payload.decision !== VerificationStatus.VERIFIED) return request;

  const matching = await dispatchVerifiedRequestMatching(id);
  if (matching.status === "COMPLETED") {
    request = await prisma.bloodRequest.findUniqueOrThrow({
      where: { id },
      select: requestDetailSelect,
    });
  }
  return { ...request, matching };
};

export const bloodRequestService = {
  createBloodRequest,
  listBloodRequests,
  listMyBloodRequests,
  getAuthorizedBloodRequest,
  updateBloodRequest,
  deleteBloodRequest,
  cancelBloodRequest,
  verifyBloodRequest,
};
