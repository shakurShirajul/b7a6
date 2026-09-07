import httpStatus from "http-status";
import config from "../../config/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import { VerificationStatus } from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { lockDonorEvidenceForUser } from "../../shared/donor-evidence-lock.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import type {
  DonationHistoryQuery,
  UpdateDonorAvailabilityPayload,
  UpdateDonorProfilePayload,
} from "./donor.interface.js";
import {
  evaluateDonorEligibility,
  isDonorEffectivelyAvailable,
} from "./donor.eligibility.js";

const donorEligibilityPolicy = {
  minAgeYears: config.donor_policy.min_age_years,
  maxAgeYears: config.donor_policy.max_age_years,
  minWeightKg: config.donor_policy.min_weight_kg,
  minDonationIntervalDays: config.donor_policy.min_donation_interval_days,
};

const donorProfileSelect = {
  id: true,
  bloodType: true,
  isAvailable: true,
  verificationStatus: true,
  verifiedAt: true,
  weightKg: true,
  totalDonationCount: true,
  lastDonationDate: true,
  division: true,
  district: true,
  area: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      status: true,
      deletedAt: true,
      dateOfBirth: true,
    },
  },
  eligibilityAssessments: {
    orderBy: { checkedAt: "desc" },
    take: 1,
    select: {
      isEligible: true,
      checkedAt: true,
      expiresAt: true,
    },
  },
  reservation: {
    select: { expiresAt: true },
  },
} satisfies Prisma.DonorProfileSelect;

type DonorProfileResult = Prisma.DonorProfileGetPayload<{
  select: typeof donorProfileSelect;
}>;

const donationSelect = {
  id: true,
  unitCount: true,
  donatedAt: true,
  bloodRequest: {
    select: {
      id: true,
      bloodType: true,
      hospital: {
        select: {
          id: true,
          name: true,
          address: true,
          division: true,
          district: true,
          area: true,
        },
      },
    },
  },
} satisfies Prisma.DonationSelect;

const getEligibilitySummary = (
  profile: DonorProfileResult,
  now: Date,
  isAvailable = profile.isAvailable,
) => {
  const latestAssessment = profile.eligibilityAssessments[0];
  return evaluateDonorEligibility(
    {
      userStatus: profile.user.status,
      userDeletedAt: profile.user.deletedAt,
      dateOfBirth: profile.user.dateOfBirth,
      verificationStatus: profile.verificationStatus,
      isAvailable,
      bloodType: profile.bloodType,
      weightKg: Number(profile.weightKg),
      lastDonationDate: profile.lastDonationDate,
      latestAssessment: latestAssessment ?? null,
      reservationExpiresAt: profile.reservation?.expiresAt ?? null,
    },
    donorEligibilityPolicy,
    now,
  );
};

const toDonorProfileDto = (profile: DonorProfileResult, now: Date) => {
  const eligibility = getEligibilitySummary(profile, now);

  return {
    id: profile.id,
    bloodType: profile.bloodType,
    isAvailable: isDonorEffectivelyAvailable(profile.isAvailable, eligibility),
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt,
    weightKg: profile.weightKg,
    totalDonationCount: profile.totalDonationCount,
    lastDonationDate: profile.lastDonationDate,
    division: profile.division,
    district: profile.district,
    area: profile.area,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    eligibility,
  };
};

const donorAuditProjection = (profile: DonorProfileResult) => ({
  bloodType: profile.bloodType,
  isAvailable: profile.isAvailable,
  verificationStatus: profile.verificationStatus,
  weightKg: Number(profile.weightKg),
  division: profile.division,
  district: profile.district,
  area: profile.area,
});

const getProfileOrThrow = async (
  client: Pick<Prisma.TransactionClient, "donorProfile">,
  userId: number,
) => {
  const profile = await client.donorProfile.findUnique({
    where: { userId },
    select: donorProfileSelect,
  });

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Donor profile not found");
  }

  return profile;
};

const getMyProfile = async (userId: number) => {
  const profile = await getProfileOrThrow(prisma, userId);
  return toDonorProfileDto(profile, new Date());
};

const valuesDiffer = (existingValue: unknown, nextValue: unknown) => {
  if (existingValue === null || nextValue === null) {
    return existingValue !== nextValue;
  }

  if (typeof nextValue === "number") {
    return Number(existingValue) !== nextValue;
  }

  return existingValue !== nextValue;
};

const evidenceFields = [
  "bloodType",
  "weightKg",
  "division",
  "district",
  "area",
  "latitude",
  "longitude",
] as const satisfies readonly (keyof UpdateDonorProfilePayload)[];

const updateMyProfile = async (
  userId: number,
  payload: UpdateDonorProfilePayload,
  context: TRequestContext,
) =>
  prisma.$transaction(async (transaction) => {
    await lockDonorEvidenceForUser(transaction, userId);
    const existingProfile = await getProfileOrThrow(transaction, userId);
    const evidenceChanged = evidenceFields.some(
      (field) =>
        payload[field] !== undefined &&
        valuesDiffer(existingProfile[field], payload[field]),
    );
    const data: Prisma.DonorProfileUpdateInput = { ...payload };

    if (evidenceChanged) {
      data.verificationStatus = VerificationStatus.PENDING;
      data.verifiedAt = null;
      data.verifiedBy = { disconnect: true };
      data.isAvailable = false;
    }

    const profile = await transaction.donorProfile.update({
      where: { userId },
      data,
      select: donorProfileSelect,
    });

    await recordAuditEvent(
      {
        actorId: userId,
        action: evidenceChanged
          ? "DONOR_PROFILE_UPDATED_REVERIFICATION_REQUIRED"
          : "DONOR_PROFILE_UPDATED",
        entityType: "DonorProfile",
        entityId: String(existingProfile.id),
        before: donorAuditProjection(existingProfile),
        after: donorAuditProjection(profile),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return toDonorProfileDto(profile, new Date());
  });

const AVAILABILITY_TRANSACTION_ATTEMPTS = 3;
const contentionCodes = new Set(["P2002", "P2034"]);

const isContentionError = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  contentionCodes.has(error.code);

const updateMyAvailabilityOnce = (
  userId: number,
  payload: UpdateDonorAvailabilityPayload,
  context: TRequestContext,
) =>
  prisma.$transaction(
    async (transaction) => {
      const existingProfile = await getProfileOrThrow(transaction, userId);
      const now = new Date();

      if (
        payload.isAvailable &&
        !getEligibilitySummary(existingProfile, now, true).isEligible
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor availability cannot be enabled until all eligibility requirements are met",
        );
      }

      const profile = await transaction.donorProfile.update({
        where: { userId },
        data: { isAvailable: payload.isAvailable },
        select: donorProfileSelect,
      });

      await recordAuditEvent(
        {
          actorId: userId,
          action: "DONOR_AVAILABILITY_UPDATED",
          entityType: "DonorProfile",
          entityId: String(existingProfile.id),
          before: { isAvailable: existingProfile.isAvailable },
          after: { isAvailable: profile.isAvailable },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );

      return toDonorProfileDto(profile, now);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

const updateMyAvailability = async (
  userId: number,
  payload: UpdateDonorAvailabilityPayload,
  context: TRequestContext,
) => {
  for (
    let attempt = 1;
    attempt <= AVAILABILITY_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await updateMyAvailabilityOnce(userId, payload, context);
    } catch (error) {
      if (!isContentionError(error)) throw error;
      if (attempt === AVAILABILITY_TRANSACTION_ATTEMPTS) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Donor availability changed concurrently. Please retry.",
        );
      }
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "Donor availability changed concurrently. Please retry.",
  );
};

const getMyDonations = async (userId: number, query: DonationHistoryQuery) => {
  const donor = await prisma.donorProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!donor) {
    throw new AppError(httpStatus.NOT_FOUND, "Donor profile not found");
  }

  const skip = (query.page - 1) * query.limit;
  const where = { donorId: donor.id } satisfies Prisma.DonationWhereInput;
  const [data, total] = await prisma.$transaction([
    prisma.donation.findMany({
      where,
      select: donationSelect,
      orderBy: [{ donatedAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.donation.count({ where }),
  ]);

  return {
    data,
    meta: { page: query.page, limit: query.limit, total },
  };
};

export const donorService = {
  getMyProfile,
  updateMyProfile,
  updateMyAvailability,
  getMyDonations,
};
