import httpStatus from "http-status";
import config from "../../config/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  AssignmentStatus,
  BloodRequestStatus,
  NotificationType,
  UserStatus,
  VerificationStatus,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { isDonorEffectivelyAvailable } from "../donor/donor.eligibility.js";
import { getCompatibleDonorTypes } from "./compatibility.js";
import {
  calculateBoundingBox,
  calculateDistanceKm,
  hasCompleteCoordinates,
} from "./distance.js";
import { evaluateDonorEligibility } from "./eligibility.js";
import { calculateMatchScore, compareRankedMatches } from "./priority.js";
import { publishPendingOutboxEvents } from "../../jobs/queue.js";
import { invalidateDashboardCache } from "../../shared/dashboard-cache.js";
import { lockVerifiedHospitalForRequest } from "../../shared/hospital-lock.js";

const millisecondsPerDay = 24 * 60 * 60 * 1_000;
const recentInvitationWindowDays = 30;
const matchingTransactionAttempts = 3;
const matchingOutboxBatchSize = 100;

const donorEligibilityPolicy = {
  minAgeYears: config.donor_policy.min_age_years,
  maxAgeYears: config.donor_policy.max_age_years,
  minWeightKg: config.donor_policy.min_weight_kg,
  minDonationIntervalDays: config.donor_policy.min_donation_interval_days,
};

const requestSelect = {
  id: true,
  hospitalId: true,
  bloodType: true,
  urgency: true,
  status: true,
  unitsRequired: true,
  unitsFulfilled: true,
  requiredAt: true,
  division: true,
  district: true,
  area: true,
  latitude: true,
  longitude: true,
  deletedAt: true,
} satisfies Prisma.BloodRequestSelect;

const createCandidateSelect = (
  recentInvitationCutoff: Date,
  bloodRequestId: number,
) =>
  ({
    id: true,
    bloodType: true,
    isAvailable: true,
    verificationStatus: true,
    weightKg: true,
    lastDonationDate: true,
    division: true,
    district: true,
    area: true,
    latitude: true,
    longitude: true,
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
    reservation: { select: { expiresAt: true } },
    assignments: {
      where: { bloodRequestId },
      orderBy: { id: "desc" as const },
      take: 1,
      select: {
        id: true,
        bloodRequestId: true,
        status: true,
        invitedAt: true,
      },
    },
    _count: {
      select: {
        assignments: {
          where: { invitedAt: { gte: recentInvitationCutoff } },
        },
      },
    },
  }) satisfies Prisma.DonorProfileSelect;

type Candidate = Prisma.DonorProfileGetPayload<{
  select: ReturnType<typeof createCandidateSelect>;
}>;

type RankedCandidate = {
  donorId: number;
  userId: number;
  score: number;
  distanceKm: number | null;
  matchReason:
    | "WITHIN_RADIUS"
    | "SAME_AREA_FALLBACK"
    | "SAME_DISTRICT_FALLBACK"
    | "SAME_DIVISION_FALLBACK";
};

const normalizePlace = (place: string) => place.trim().toLocaleLowerCase("en");

const samePlace = (left: string, right: string) =>
  normalizePlace(left) === normalizePlace(right);

const getLocationMatch = (
  request: Prisma.BloodRequestGetPayload<{ select: typeof requestSelect }>,
  candidate: Candidate,
  radiusKm: number,
):
  | (Pick<RankedCandidate, "distanceKm" | "matchReason"> & {
      scoringDistanceKm: number;
    })
  | null => {
  if (
    hasCompleteCoordinates(request.latitude, request.longitude) &&
    hasCompleteCoordinates(candidate.latitude, candidate.longitude)
  ) {
    const distanceKm = calculateDistanceKm(
      Number(request.latitude),
      Number(request.longitude),
      Number(candidate.latitude),
      Number(candidate.longitude),
    );
    if (distanceKm > radiusKm) return null;
    return {
      distanceKm,
      scoringDistanceKm: distanceKm,
      matchReason: "WITHIN_RADIUS",
    };
  }

  if (!samePlace(request.division, candidate.division)) return null;
  if (
    samePlace(request.district, candidate.district) &&
    samePlace(request.area, candidate.area)
  ) {
    return {
      distanceKm: null,
      scoringDistanceKm: 0,
      matchReason: "SAME_AREA_FALLBACK",
    };
  }
  if (samePlace(request.district, candidate.district)) {
    return {
      distanceKm: null,
      scoringDistanceKm: radiusKm,
      matchReason: "SAME_DISTRICT_FALLBACK",
    };
  }
  return {
    distanceKm: null,
    scoringDistanceKm: radiusKm * 2,
    matchReason: "SAME_DIVISION_FALLBACK",
  };
};

const coordinateLocationWhere = (
  latitude: number,
  longitude: number,
  radiusKm: number,
  division: string,
): Prisma.DonorProfileWhereInput => {
  const box = calculateBoundingBox(latitude, longitude, radiusKm);
  const longitudeWhere: Prisma.DonorProfileWhereInput = box.crossesAntimeridian
    ? {
        OR: [
          { longitude: { gte: box.minLongitude } },
          { longitude: { lte: box.maxLongitude } },
        ],
      }
    : {
        longitude: {
          gte: box.minLongitude,
          lte: box.maxLongitude,
        },
      };

  return {
    OR: [
      {
        AND: [
          {
            latitude: { not: null, gte: box.minLatitude, lte: box.maxLatitude },
          },
          { longitude: { not: null } },
          longitudeWhere,
        ],
      },
      {
        AND: [
          { OR: [{ latitude: null }, { longitude: null }] },
          { division: { equals: division, mode: "insensitive" } },
        ],
      },
    ],
  };
};

const getCandidateWhere = (
  request: Prisma.BloodRequestGetPayload<{ select: typeof requestSelect }>,
  radiusKm: number,
  now: Date,
): Prisma.DonorProfileWhereInput => {
  const compatibleBloodTypes = getCompatibleDonorTypes(request.bloodType);
  const intervalCutoff = new Date(
    now.getTime() -
      donorEligibilityPolicy.minDonationIntervalDays * millisecondsPerDay,
  );
  const locationWhere: Prisma.DonorProfileWhereInput = hasCompleteCoordinates(
    request.latitude,
    request.longitude,
  )
    ? coordinateLocationWhere(
        Number(request.latitude),
        Number(request.longitude),
        radiusKm,
        request.division,
      )
    : { division: { equals: request.division, mode: "insensitive" } };

  return {
    AND: [locationWhere],
    bloodType: { in: [...compatibleBloodTypes] },
    verificationStatus: VerificationStatus.VERIFIED,
    isAvailable: true,
    OR: [
      { lastDonationDate: null },
      { lastDonationDate: { lte: intervalCutoff } },
    ],
    user: {
      is: { status: UserStatus.ACTIVE, deletedAt: null },
    },
    assignments: { none: { bloodRequestId: request.id } },
  };
};

const daysSinceLastDonation = (lastDonationDate: Date | null, now: Date) =>
  lastDonationDate
    ? Math.max(
        0,
        (now.getTime() - lastDonationDate.getTime()) / millisecondsPerDay,
      )
    : donorEligibilityPolicy.minDonationIntervalDays * 2;

const rankCandidates = (
  request: Prisma.BloodRequestGetPayload<{ select: typeof requestSelect }>,
  candidates: Candidate[],
  radiusKm: number,
  now: Date,
) =>
  candidates
    .flatMap((candidate): RankedCandidate[] => {
      const latestAssessment = candidate.eligibilityAssessments[0] ?? null;
      const existingRequestAssignment = candidate.assignments[0] ?? null;
      const eligibility = evaluateDonorEligibility(
        {
          userStatus: candidate.user.status,
          userDeletedAt: candidate.user.deletedAt,
          dateOfBirth: candidate.user.dateOfBirth,
          verificationStatus: candidate.verificationStatus,
          isAvailable: candidate.isAvailable,
          bloodType: candidate.bloodType,
          weightKg: Number(candidate.weightKg),
          lastDonationDate: candidate.lastDonationDate,
          latestAssessment,
          reservationExpiresAt: candidate.reservation?.expiresAt ?? null,
          requestContext: {
            recipientBloodType: request.bloodType,
            assignmentStatus: existingRequestAssignment?.status ?? null,
          },
        },
        donorEligibilityPolicy,
        now,
      );
      if (!isDonorEffectivelyAvailable(candidate.isAvailable, eligibility)) {
        return [];
      }

      const location = getLocationMatch(request, candidate, radiusKm);
      if (!location) return [];

      return [
        {
          donorId: candidate.id,
          userId: candidate.user.id,
          distanceKm: location.distanceKm,
          matchReason: location.matchReason,
          score: calculateMatchScore({
            urgency: request.urgency,
            requiredAt: request.requiredAt,
            now,
            distanceKm: location.scoringDistanceKm,
            daysSinceLastDonation: daysSinceLastDonation(
              candidate.lastDonationDate,
              now,
            ),
            recentInvitationCount: candidate._count.assignments,
          }),
        },
      ];
    })
    .sort(compareRankedMatches);

const requestCanBeMatched = (status: BloodRequestStatus) =>
  status === BloodRequestStatus.VERIFIED ||
  status === BloodRequestStatus.MATCHING ||
  status === BloodRequestStatus.PARTIALLY_FULFILLED;

const loadMatchableRequest = async (requestId: number) => {
  const request = await prisma.bloodRequest.findUnique({
    where: { id: requestId },
    select: requestSelect,
  });
  if (!request || request.deletedAt) {
    throw new AppError(httpStatus.NOT_FOUND, "Blood request not found");
  }
  if (!requestCanBeMatched(request.status)) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Blood requests in ${request.status} status cannot be matched`,
    );
  }
  if (request.unitsFulfilled >= request.unitsRequired) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Blood request is already fulfilled",
    );
  }
  if (request.requiredAt <= new Date()) {
    throw new AppError(httpStatus.CONFLICT, "Blood request is overdue");
  }
  return request;
};

const persistMatches = async (
  requestId: number,
  selectedDonorIds: readonly number[],
  radiusKm: number,
) =>
  prisma.$transaction(
    async (transaction) => {
      const transactionNow = new Date();
      const currentRequest = await transaction.bloodRequest.findUnique({
        where: { id: requestId },
        select: requestSelect,
      });
      if (
        !currentRequest ||
        currentRequest.deletedAt ||
        !requestCanBeMatched(currentRequest.status) ||
        currentRequest.unitsFulfilled >= currentRequest.unitsRequired ||
        currentRequest.requiredAt <= transactionNow
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Blood request changed before matching completed",
        );
      }

      const recentInvitationCutoff = new Date(
        transactionNow.getTime() -
          recentInvitationWindowDays * millisecondsPerDay,
      );
      await lockVerifiedHospitalForRequest(
        transaction,
        currentRequest.hospitalId,
      );
      const currentCandidates = selectedDonorIds.length
        ? await transaction.donorProfile.findMany({
            where: { id: { in: [...selectedDonorIds] } },
            select: createCandidateSelect(recentInvitationCutoff, requestId),
            orderBy: { id: "asc" },
            take: selectedDonorIds.length,
          })
        : [];
      const currentlyEligible = rankCandidates(
        currentRequest,
        currentCandidates,
        radiusKm,
        transactionNow,
      );

      const activeAssignmentCount = await transaction.donorAssignment.count({
        where: {
          bloodRequestId: requestId,
          OR: [
            {
              status: AssignmentStatus.INVITED,
              expiresAt: { gt: transactionNow },
            },
            {
              status: AssignmentStatus.ACCEPTED,
              reservation: { is: { expiresAt: { gt: transactionNow } } },
            },
          ],
        },
      });
      const remainingInvitationSlots = Math.max(
        0,
        config.matching.max_invitations - activeAssignmentCount,
      );
      const ranked = currentlyEligible.slice(0, remainingInvitationSlots);
      const expiresAt = new Date(
        transactionNow.getTime() +
          config.matching.invitation_ttl_minutes * 60 * 1_000,
      );
      const insertion = ranked.length
        ? await transaction.donorAssignment.createMany({
            data: ranked.map((match) => ({
              bloodRequestId: requestId,
              donorId: match.donorId,
              status: AssignmentStatus.INVITED,
              score: match.score,
              distanceKm:
                match.distanceKm === null
                  ? null
                  : Math.round(match.distanceKm * 100) / 100,
              matchReason: match.matchReason,
              invitedAt: transactionNow,
              expiresAt,
            })),
            skipDuplicates: true,
          })
        : { count: 0 };

      const assignments = ranked.length
        ? await transaction.donorAssignment.findMany({
            where: {
              bloodRequestId: requestId,
              donorId: { in: ranked.map((match) => match.donorId) },
              status: AssignmentStatus.INVITED,
              expiresAt: { gt: transactionNow },
            },
            select: {
              id: true,
              donorId: true,
              score: true,
              distanceKm: true,
              matchReason: true,
              expiresAt: true,
              donor: { select: { userId: true } },
            },
            take: ranked.length,
          })
        : [];

      if (assignments.length > 0) {
        await transaction.notification.createMany({
          data: assignments.map((assignment) => ({
            userId: assignment.donor.userId,
            bloodRequestId: requestId,
            donorAssignmentId: assignment.id,
            title: "New blood donation invitation",
            message: `A compatible request in ${currentRequest.district} may need your help. Sign in to review the invitation.`,
            type: NotificationType.DONOR_INVITATION,
            deduplicationKey: `donor-invitation:${assignment.id}`,
          })),
          skipDuplicates: true,
        });
      }

      const notifications = assignments.length
        ? await transaction.notification.findMany({
            where: {
              donorAssignmentId: { in: assignments.map(({ id }) => id) },
              type: NotificationType.DONOR_INVITATION,
            },
            select: { id: true, donorAssignmentId: true },
            take: assignments.length,
          })
        : [];
      if (notifications.length > 0) {
        await transaction.outboxEvent.createMany({
          data: notifications.map((notification) => ({
            type: "SEND_DONOR_INVITATION_EMAIL",
            aggregateId: String(notification.donorAssignmentId),
            deduplicationKey: `email-notification:${notification.id}`,
            payload: { notificationId: notification.id },
          })),
          skipDuplicates: true,
        });
      }

      const activeInvitationCount = await transaction.donorAssignment.count({
        where: {
          bloodRequestId: requestId,
          status: AssignmentStatus.INVITED,
          expiresAt: { gt: transactionNow },
        },
      });
      if (
        activeInvitationCount > 0 &&
        (currentRequest.status === BloodRequestStatus.VERIFIED ||
          currentRequest.status === BloodRequestStatus.PARTIALLY_FULFILLED)
      ) {
        const transitioned = await transaction.bloodRequest.updateMany({
          where: {
            id: requestId,
            status: currentRequest.status,
            deletedAt: null,
          },
          data: { status: BloodRequestStatus.MATCHING },
        });
        if (transitioned.count !== 1) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Blood request changed while invitations were being created",
          );
        }
      }

      const outboxEvents = notifications.length
        ? await transaction.outboxEvent.findMany({
            where: {
              type: "SEND_DONOR_INVITATION_EMAIL",
              deduplicationKey: {
                in: notifications.map(({ id }) => `email-notification:${id}`),
              },
              processedAt: null,
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: matchingOutboxBatchSize + 1,
          })
        : [];

      return {
        eligibleCandidateCount: currentlyEligible.length,
        createdCount: insertion.count,
        activeInvitationCount,
        activeAssignmentCount: activeAssignmentCount + insertion.count,
        assignments: assignments.map(
          ({ donor: _donor, ...assignment }) => assignment,
        ),
        outboxEventIds: outboxEvents
          .slice(0, matchingOutboxBatchSize)
          .map(({ id }) => id),
        hasAdditionalPendingOutboxEvents:
          outboxEvents.length > matchingOutboxBatchSize,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const matchDonors = async (requestId: number, radiusKm: number) => {
  if (!Number.isInteger(requestId) || requestId <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid blood request ID");
  }
  if (
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0 ||
    radiusKm > config.matching.max_radius_km
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Matching radius must be between 0 and ${config.matching.max_radius_km} km`,
    );
  }

  const request = await loadMatchableRequest(requestId);
  const now = new Date();
  const recentInvitationCutoff = new Date(
    now.getTime() - recentInvitationWindowDays * millisecondsPerDay,
  );
  const where = getCandidateWhere(request, radiusKm, now);
  // Freeze a finite upper boundary so concurrent registrations cannot keep a
  // sweep alive. Every page advances even when all of its donors are ineligible.
  const lastCandidate = await prisma.donorProfile.findFirst({
    where,
    select: { id: true },
    orderBy: { id: "desc" },
  });
  const ranked: RankedCandidate[] = [];
  let candidatesConsidered = 0;
  let afterId = 0;
  const pageSize = Math.min(200, config.matching.max_candidates);
  while (
    lastCandidate &&
    afterId < lastCandidate.id &&
    ranked.length < config.matching.max_candidates
  ) {
    const candidates = await prisma.donorProfile.findMany({
      where: { AND: [where, { id: { gt: afterId, lte: lastCandidate.id } }] },
      select: createCandidateSelect(recentInvitationCutoff, requestId),
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (candidates.length === 0) break;
    candidatesConsidered += candidates.length;
    afterId = candidates[candidates.length - 1]!.id;
    ranked.push(
      ...rankCandidates(request, candidates, radiusKm, new Date()).slice(
        0,
        config.matching.max_candidates - ranked.length,
      ),
    );
  }
  ranked.sort(compareRankedMatches);

  let persisted: Awaited<ReturnType<typeof persistMatches>> | undefined;
  for (let attempt = 1; attempt <= matchingTransactionAttempts; attempt += 1) {
    try {
      persisted = await persistMatches(
        requestId,
        ranked.map(({ donorId }) => donorId),
        radiusKm,
      );
      break;
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === matchingTransactionAttempts) throw error;
    }
  }
  if (!persisted) {
    throw new AppError(httpStatus.CONFLICT, "Matching could not be completed");
  }

  let queuePublicationDeferred =
    persisted.outboxEventIds.length > 0 ||
    persisted.hasAdditionalPendingOutboxEvents;
  try {
    const publication = await publishPendingOutboxEvents({
      ids: persisted.outboxEventIds,
    });
    queuePublicationDeferred =
      publication.deferred > 0 || persisted.hasAdditionalPendingOutboxEvents;
  } catch {
    console.error("Post-commit matching outbox publication was deferred", {
      requestId,
      eventCount: persisted.outboxEventIds.length,
    });
  }

  await invalidateDashboardCache();
  return {
    requestId,
    radiusKm,
    candidatesConsidered,
    eligibleCandidates: persisted.eligibleCandidateCount,
    invitationsCreated: persisted.createdCount,
    activeInvitationCount: persisted.activeInvitationCount,
    activeAssignmentCount: persisted.activeAssignmentCount,
    assignments: persisted.assignments,
    queuePublicationDeferred,
  };
};
