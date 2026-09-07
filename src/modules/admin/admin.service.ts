import httpStatus from "http-status";
import config from "../../config/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  BloodRequestStatus,
  BloodType,
  PaymentStatus,
  UserStatus,
  VerificationStatus,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import { evaluateDonorEligibility } from "../donor/donor.eligibility.js";
import { runRequestMatching } from "../matching/dispatch.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { lockDonorEvidenceForProfile } from "../../shared/donor-evidence-lock.js";
import {
  getDashboardCache,
  invalidateDashboardCache,
  setDashboardCache,
} from "../../shared/dashboard-cache.js";
import type {
  AdminAuditLogQuery,
  AdminDashboardQuery,
  AdminDonationReportQuery,
  AdminDonorVerifyPayload,
  AdminHospitalCreatePayload,
  AdminHospitalUpdatePayload,
  AdminRematchPayload,
  AdminUserListQuery,
  AdminUserStatusPayload,
} from "./admin.interface.js";

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  patientProfile: {
    select: { id: true, bloodType: true, totalReceivedCount: true },
  },
  donorProfile: {
    select: {
      id: true,
      bloodType: true,
      isAvailable: true,
      verificationStatus: true,
      totalDonationCount: true,
      division: true,
      district: true,
      area: true,
    },
  },
} satisfies Prisma.UserSelect;

const hospitalSelect = {
  id: true,
  name: true,
  address: true,
  contactPhone: true,
  contactEmail: true,
  division: true,
  district: true,
  area: true,
  latitude: true,
  longitude: true,
  verificationStatus: true,
  verifiedAt: true,
  verifiedById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.HospitalSelect;

const donorModerationSelect = {
  id: true,
  userId: true,
  bloodType: true,
  isAvailable: true,
  verificationStatus: true,
  verifiedAt: true,
  verifiedById: true,
  weightKg: true,
  totalDonationCount: true,
  lastDonationDate: true,
  division: true,
  district: true,
  area: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      deletedAt: true,
      dateOfBirth: true,
    },
  },
  eligibilityAssessments: {
    orderBy: [{ checkedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      isEligible: true,
      checkedById: true,
      checkedAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.DonorProfileSelect;

const dateWhere = (query: { from?: Date; to?: Date }) =>
  query.from || query.to
    ? {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      }
    : undefined;

const hospitalAuditProjection = (
  hospital: Prisma.HospitalGetPayload<{ select: typeof hospitalSelect }>,
) => ({
  id: hospital.id,
  name: hospital.name,
  address: hospital.address,
  contactPhone: hospital.contactPhone,
  contactEmail: hospital.contactEmail,
  division: hospital.division,
  district: hospital.district,
  area: hospital.area,
  latitude: hospital.latitude === null ? null : Number(hospital.latitude),
  longitude: hospital.longitude === null ? null : Number(hospital.longitude),
  verificationStatus: hospital.verificationStatus,
  verifiedAt: hospital.verifiedAt?.toISOString() ?? null,
  verifiedById: hospital.verifiedById,
  deletedAt: hospital.deletedAt?.toISOString() ?? null,
});

const donorAuditProjection = (
  donor: Prisma.DonorProfileGetPayload<{
    select: typeof donorModerationSelect;
  }>,
) => ({
  id: donor.id,
  userId: donor.userId,
  verificationStatus: donor.verificationStatus,
  verifiedAt: donor.verifiedAt?.toISOString() ?? null,
  verifiedById: donor.verifiedById,
  isAvailable: donor.isAvailable,
  assessment: donor.eligibilityAssessments[0]
    ? {
        id: donor.eligibilityAssessments[0].id,
        isEligible: donor.eligibilityAssessments[0].isEligible,
        checkedAt: donor.eligibilityAssessments[0].checkedAt.toISOString(),
        expiresAt: donor.eligibilityAssessments[0].expiresAt.toISOString(),
      }
    : null,
});

const listUsers = async (query: AdminUserListQuery) => {
  const where = {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
            { phone: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  } satisfies Prisma.UserWhereInput;
  const primaryOrder =
    query.sortBy === "name"
      ? { name: query.sortOrder }
      : query.sortBy === "email"
        ? { email: query.sortOrder }
        : { createdAt: query.sortOrder };
  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: adminUserSelect,
      orderBy: [primaryOrder, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);
  return { data, meta: { page: query.page, limit: query.limit, total } };
};

const updateUserStatus = async (
  adminId: number,
  userId: number,
  payload: AdminUserStatusPayload,
  context: TRequestContext,
) => {
  if (adminId === userId && payload.status === UserStatus.SUSPENDED) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Administrators cannot suspend their own account",
    );
  }

  const result = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: adminUserSelect,
    });
    if (!existing) throw new AppError(httpStatus.NOT_FOUND, "User not found");
    if (
      existing.status === payload.status &&
      payload.status !== UserStatus.SUSPENDED
    ) {
      return existing;
    }

    if (existing.status !== payload.status) {
      const updated = await transaction.user.updateMany({
        where: { id: userId, status: existing.status, deletedAt: null },
        data: { status: payload.status },
      });
      if (updated.count !== 1) {
        throw new AppError(
          httpStatus.CONFLICT,
          "User changed while status was being updated",
        );
      }
    }
    let sessionsRevoked = 0;
    let donorProfilesDisabled = 0;
    if (payload.status === UserStatus.SUSPENDED) {
      const now = new Date();
      const sessionUpdate = await transaction.refreshSession.updateMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      const donorUpdate = await transaction.donorProfile.updateMany({
        where: { userId, isAvailable: true },
        data: { isAvailable: false },
      });
      sessionsRevoked = sessionUpdate.count;
      donorProfilesDisabled = donorUpdate.count;
    }
    const current = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: adminUserSelect,
    });
    await recordAuditEvent(
      {
        actorId: adminId,
        action:
          payload.status === UserStatus.SUSPENDED
            ? existing.status === UserStatus.SUSPENDED
              ? "USER_SUSPENSION_ENFORCED"
              : "USER_SUSPENDED"
            : "USER_REACTIVATED",
        entityType: "User",
        entityId: String(userId),
        before: { status: existing.status },
        after: {
          status: current.status,
          sessionsRevoked,
          donorProfilesDisabled,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return current;
  });
  await invalidateDashboardCache();
  return result;
};

const createHospital = async (
  adminId: number,
  payload: AdminHospitalCreatePayload,
  context: TRequestContext,
) => {
  const hospital = await prisma.$transaction(async (transaction) => {
    const verified = payload.verificationStatus === VerificationStatus.VERIFIED;
    const created = await transaction.hospital.create({
      data: {
        ...payload,
        verifiedAt: verified ? new Date() : null,
        verifiedById: verified ? adminId : null,
      },
      select: hospitalSelect,
    });
    await recordAuditEvent(
      {
        actorId: adminId,
        action: "HOSPITAL_CREATED",
        entityType: "Hospital",
        entityId: String(created.id),
        after: hospitalAuditProjection(created),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return created;
  });
  await invalidateDashboardCache();
  return hospital;
};

const liveRequestStatuses = [
  BloodRequestStatus.PENDING_VERIFICATION,
  BloodRequestStatus.VERIFIED,
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
] as const;
const hospitalModerationTransactionAttempts = 3;

const updateHospitalOnce = (
  adminId: number,
  hospitalId: number,
  payload: AdminHospitalUpdatePayload,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "Hospital"
        WHERE "id" = ${hospitalId}
        FOR UPDATE
      `);
      const existing = await transaction.hospital.findFirst({
        where: { id: hospitalId, deletedAt: null },
        select: hospitalSelect,
      });
      if (!existing) {
        throw new AppError(httpStatus.NOT_FOUND, "Hospital not found");
      }

      const verificationSensitiveFields = [
        "name",
        "address",
        "division",
        "district",
        "area",
        "latitude",
        "longitude",
      ];
      const requiresReview =
        payload.action === "UPDATE" &&
        verificationSensitiveFields.some((field) =>
          Object.prototype.hasOwnProperty.call(payload, field),
        );
      const demotesHospital =
        payload.action === "DELETE" ||
        requiresReview ||
        (payload.action === "VERIFY" &&
          payload.decision !== VerificationStatus.VERIFIED);
      if (demotesHospital) {
        const activeRequest = await transaction.bloodRequest.findFirst({
          where: {
            hospitalId,
            deletedAt: null,
            status: { in: [...liveRequestStatuses] },
          },
          select: { id: true },
        });
        if (activeRequest) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Hospital cannot be demoted, deleted, or have verification evidence edited while it has active blood requests",
          );
        }
      }

      let action: string;
      if (payload.action === "UPDATE") {
        const fields: Prisma.HospitalUncheckedUpdateInput = {
          name: payload.name,
          address: payload.address,
          contactPhone: payload.contactPhone,
          contactEmail: payload.contactEmail,
          division: payload.division,
          district: payload.district,
          area: payload.area,
          latitude: payload.latitude,
          longitude: payload.longitude,
        };
        await transaction.hospital.update({
          where: { id: hospitalId },
          data: {
            ...fields,
            ...(requiresReview
              ? {
                  verificationStatus: VerificationStatus.PENDING,
                  verifiedAt: null,
                  verifiedById: null,
                }
              : {}),
          },
        });
        action = requiresReview
          ? "HOSPITAL_UPDATED_REVIEW_REQUIRED"
          : "HOSPITAL_UPDATED";
      } else if (payload.action === "VERIFY") {
        const verified = payload.decision === VerificationStatus.VERIFIED;
        await transaction.hospital.update({
          where: { id: hospitalId },
          data: {
            verificationStatus: payload.decision,
            verifiedAt: verified ? new Date() : null,
            verifiedById: verified ? adminId : null,
          },
        });
        action = verified ? "HOSPITAL_VERIFIED" : "HOSPITAL_REJECTED";
      } else {
        await transaction.hospital.update({
          where: { id: hospitalId },
          data: {
            deletedAt: new Date(),
            verificationStatus: VerificationStatus.REJECTED,
            verifiedAt: null,
            verifiedById: null,
          },
        });
        action = "HOSPITAL_DELETED";
      }

      const current = await transaction.hospital.findUniqueOrThrow({
        where: { id: hospitalId },
        select: hospitalSelect,
      });
      await recordAuditEvent(
        {
          actorId: adminId,
          action,
          entityType: "Hospital",
          entityId: String(hospitalId),
          before: hospitalAuditProjection(existing),
          after: {
            ...hospitalAuditProjection(current),
            ...(payload.action === "VERIFY"
              ? { reasonCode: payload.reasonCode ?? null }
              : {}),
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
      return current;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

const updateHospital = async (
  adminId: number,
  hospitalId: number,
  payload: AdminHospitalUpdatePayload,
  context: TRequestContext,
) => {
  for (
    let attempt = 1;
    attempt <= hospitalModerationTransactionAttempts;
    attempt += 1
  ) {
    try {
      const hospital = await updateHospitalOnce(
        adminId,
        hospitalId,
        payload,
        context,
      );
      await invalidateDashboardCache();
      return hospital;
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable) throw error;
      if (attempt === hospitalModerationTransactionAttempts) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Hospital could not be updated due to concurrent changes",
        );
      }
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "Hospital could not be updated due to concurrent changes",
  );
};

const verifyDonorOnce = async (
  adminId: number,
  donorId: number,
  payload: AdminDonorVerifyPayload,
  context: TRequestContext,
) => {
  const donor = await prisma.$transaction(async (transaction) => {
    await lockDonorEvidenceForProfile(transaction, donorId);
    const existing = await transaction.donorProfile.findUnique({
      where: { id: donorId },
      select: donorModerationSelect,
    });
    if (!existing || existing.user.deletedAt) {
      throw new AppError(httpStatus.NOT_FOUND, "Donor profile not found");
    }
    const now = new Date();
    const verified = payload.decision === VerificationStatus.VERIFIED;
    if (payload.isEligible) {
      const eligibility = evaluateDonorEligibility(
        {
          userStatus: existing.user.status,
          userDeletedAt: existing.user.deletedAt,
          dateOfBirth: existing.user.dateOfBirth,
          verificationStatus: VerificationStatus.VERIFIED,
          isAvailable: true,
          bloodType: existing.bloodType,
          weightKg: Number(existing.weightKg),
          lastDonationDate: existing.lastDonationDate,
          latestAssessment: {
            isEligible: true,
            checkedAt: now,
            expiresAt: payload.expiresAt,
          },
          reservationExpiresAt: null,
        },
        {
          minAgeYears: config.donor_policy.min_age_years,
          maxAgeYears: config.donor_policy.max_age_years,
          minWeightKg: config.donor_policy.min_weight_kg,
          minDonationIntervalDays:
            config.donor_policy.min_donation_interval_days,
        },
        now,
      );
      if (!eligibility.isEligible) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor does not satisfy the configured eligibility policy",
        );
      }
    }
    await transaction.donorProfile.update({
      where: { id: donorId },
      data: {
        verificationStatus: payload.decision,
        verifiedAt: verified ? now : null,
        verifiedById: verified ? adminId : null,
        isAvailable: false,
      },
    });
    await transaction.eligibilityAssessment.create({
      data: {
        donorId,
        isEligible: verified && payload.isEligible,
        reasonCode: payload.reasonCode,
        checkedById: adminId,
        checkedAt: now,
        expiresAt: payload.expiresAt,
      },
    });
    const current = await transaction.donorProfile.findUniqueOrThrow({
      where: { id: donorId },
      select: donorModerationSelect,
    });
    await recordAuditEvent(
      {
        actorId: adminId,
        action: verified ? "DONOR_PROFILE_VERIFIED" : "DONOR_PROFILE_REJECTED",
        entityType: "DonorProfile",
        entityId: String(donorId),
        before: donorAuditProjection(existing),
        after: {
          ...donorAuditProjection(current),
          assessmentReasonRecorded: payload.reasonCode !== undefined,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return current;
  });
  await invalidateDashboardCache();
  return donor;
};

const verifyDonor = async (
  adminId: number,
  donorId: number,
  payload: AdminDonorVerifyPayload,
  context: TRequestContext,
) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await verifyDonorOnce(adminId, donorId, payload, context);
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034"
      )
        throw error;
      if (attempt === 3)
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor evidence changed concurrently. Please retry verification.",
        );
    }
  }
  throw new AppError(
    httpStatus.CONFLICT,
    "Donor verification could not be completed",
  );
};

const rematchBloodRequest = async (
  adminId: number,
  requestId: number,
  payload: AdminRematchPayload,
  context: TRequestContext,
) => {
  await prisma.$transaction(async (transaction) => {
    const request = await transaction.bloodRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      select: {
        id: true,
        status: true,
        unitsRequired: true,
        unitsFulfilled: true,
        requiredAt: true,
      },
    });
    if (!request) {
      throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
    }
    if (
      request.status !== BloodRequestStatus.VERIFIED &&
      request.status !== BloodRequestStatus.MATCHING &&
      request.status !== BloodRequestStatus.PARTIALLY_FULFILLED
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        `Blood requests in ${request.status} status cannot be rematched`,
      );
    }
    if (
      request.unitsFulfilled >= request.unitsRequired ||
      request.requiredAt <= new Date()
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Blood request is not eligible for rematching",
      );
    }
    await recordAuditEvent(
      {
        actorId: adminId,
        action: "BLOOD_REQUEST_REMATCH_REQUESTED",
        entityType: "BloodRequest",
        entityId: String(requestId),
        before: {
          status: request.status,
          unitsRequired: request.unitsRequired,
          unitsFulfilled: request.unitsFulfilled,
        },
        after: { radiusKm: payload.radiusKm },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
  });

  const result = await runRequestMatching(requestId, payload.radiusKm);
  await invalidateDashboardCache();
  return result;
};

const statusCounts = <T extends string>(
  statuses: readonly T[],
  groups: readonly { status: T; _count: { _all: number } }[],
) =>
  Object.fromEntries(
    statuses.map((status) => [
      status,
      groups.find((group) => group.status === status)?._count._all ?? 0,
    ]),
  ) as Record<T, number>;

const getDashboard = async (query: AdminDashboardQuery) => {
  const cacheKey = `v1:${query.from?.toISOString() ?? "all"}:${query.to?.toISOString() ?? "all"}`;
  const cacheSnapshot =
    await getDashboardCache<Record<string, unknown>>(cacheKey);
  if (cacheSnapshot.value) return cacheSnapshot.value;

  const createdAt = dateWhere(query);
  const userWhere = { deletedAt: null, createdAt };
  const requestWhere = { deletedAt: null, createdAt };
  const paymentWhere = { createdAt };
  const [
    userTotal,
    userGroups,
    requestTotal,
    requestGroups,
    paymentTotal,
    paymentGroups,
  ] = await prisma.$transaction(
    [
      prisma.user.count({ where: userWhere }),
      prisma.user.groupBy({
        by: ["status"],
        where: userWhere,
        _count: { _all: true },
      }),
      prisma.bloodRequest.count({ where: requestWhere }),
      prisma.bloodRequest.groupBy({
        by: ["status"],
        where: requestWhere,
        _count: { _all: true },
      }),
      prisma.payment.count({ where: paymentWhere }),
      prisma.payment.groupBy({
        by: ["status"],
        where: paymentWhere,
        _count: { _all: true },
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const dashboard = {
    range: {
      from: query.from?.toISOString() ?? null,
      to: query.to?.toISOString() ?? null,
    },
    users: {
      total: userTotal,
      byStatus: statusCounts(Object.values(UserStatus), userGroups),
    },
    bloodRequests: {
      total: requestTotal,
      byStatus: statusCounts(Object.values(BloodRequestStatus), requestGroups),
    },
    payments: {
      total: paymentTotal,
      byStatus: statusCounts(Object.values(PaymentStatus), paymentGroups),
    },
    generatedAt: new Date().toISOString(),
  };
  await setDashboardCache(cacheKey, dashboard, cacheSnapshot.version);
  return dashboard;
};

type DonationSummaryRow = {
  donationCount: number;
  unitCount: number;
  donorCount: number;
  requestCount: number;
};

type DonationBloodTypeRow = {
  bloodType: BloodType;
  donationCount: number;
  unitCount: number;
};

type DonationLocationRow = {
  division: string;
  district: string;
  area: string;
  donationCount: number;
  unitCount: number;
};

const donationReportWhereSql = (query: AdminDonationReportQuery) => {
  const filters: Prisma.Sql[] = [];
  if (query.from) filters.push(Prisma.sql`d."donatedAt" >= ${query.from}`);
  if (query.to) filters.push(Prisma.sql`d."donatedAt" <= ${query.to}`);
  if (query.bloodType) {
    filters.push(Prisma.sql`dp."bloodType" = ${query.bloodType}::"BloodType"`);
  }
  if (query.division) {
    filters.push(Prisma.sql`br."division" ILIKE ${query.division}`);
  }
  if (query.district) {
    filters.push(Prisma.sql`br."district" ILIKE ${query.district}`);
  }
  if (query.area) filters.push(Prisma.sql`br."area" ILIKE ${query.area}`);
  return filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;
};

const getDonationReport = async (query: AdminDonationReportQuery) => {
  const whereSql = donationReportWhereSql(query);
  const [summaryRows, byBloodType, byLocation] = await prisma.$transaction(
    async (transaction) => {
      const joins = Prisma.sql`
        FROM "Donation" d
        JOIN "DonorProfile" dp ON dp.id = d."donorId"
        JOIN "BloodRequest" br ON br.id = d."bloodRequestId"
      `;
      const summary = await transaction.$queryRaw<DonationSummaryRow[]>(
        Prisma.sql`
          SELECT
            COUNT(*)::integer AS "donationCount",
            COALESCE(SUM(d."unitCount"), 0)::integer AS "unitCount",
            COUNT(DISTINCT d."donorId")::integer AS "donorCount",
            COUNT(DISTINCT d."bloodRequestId")::integer AS "requestCount"
          ${joins}
          ${whereSql}
        `,
      );
      const bloodTypes = await transaction.$queryRaw<DonationBloodTypeRow[]>(
        Prisma.sql`
          SELECT
            dp."bloodType" AS "bloodType",
            COUNT(*)::integer AS "donationCount",
            COALESCE(SUM(d."unitCount"), 0)::integer AS "unitCount"
          ${joins}
          ${whereSql}
          GROUP BY dp."bloodType"
          ORDER BY dp."bloodType" ASC
          LIMIT 8
        `,
      );
      const locations = await transaction.$queryRaw<DonationLocationRow[]>(
        Prisma.sql`
          SELECT
            br."division" AS "division",
            br."district" AS "district",
            br."area" AS "area",
            COUNT(*)::integer AS "donationCount",
            COALESCE(SUM(d."unitCount"), 0)::integer AS "unitCount"
          ${joins}
          ${whereSql}
          GROUP BY br."division", br."district", br."area"
          ORDER BY "donationCount" DESC, br."division" ASC, br."district" ASC, br."area" ASC
          LIMIT 100
        `,
      );
      return [summary, bloodTypes, locations] as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    filters: {
      from: query.from?.toISOString() ?? null,
      to: query.to?.toISOString() ?? null,
      bloodType: query.bloodType ?? null,
      division: query.division ?? null,
      district: query.district ?? null,
      area: query.area ?? null,
    },
    summary: summaryRows[0] ?? {
      donationCount: 0,
      unitCount: 0,
      donorCount: 0,
      requestCount: 0,
    },
    byBloodType,
    byLocation,
  };
};

const listAuditLogs = async (query: AdminAuditLogQuery) => {
  const where = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action
      ? { action: { contains: query.action, mode: "insensitive" as const } }
      : {}),
    ...(query.entityType
      ? {
          entityType: {
            equals: query.entityType,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(dateWhere(query) ? { createdAt: dateWhere(query) } : {}),
  } satisfies Prisma.AuditLogWhereInput;
  const [data, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { data, meta: { page: query.page, limit: query.limit, total } };
};

export const adminService = {
  listUsers,
  updateUserStatus,
  createHospital,
  updateHospital,
  verifyDonor,
  rematchBloodRequest,
  getDashboard,
  getDonationReport,
  listAuditLogs,
};
