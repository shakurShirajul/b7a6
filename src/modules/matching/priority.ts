export type MatchUrgency = "NORMAL" | "HIGH" | "EMERGENCY";

export type MatchScoreInput = Readonly<{
  urgency: MatchUrgency;
  requiredAt: Date;
  now: Date;
  distanceKm: number;
  daysSinceLastDonation: number;
  recentInvitationCount: number;
}>;

const millisecondsPerHour = 60 * 60 * 1_000;

export const urgencyWeight = (urgency: MatchUrgency): number => {
  switch (urgency) {
    case "EMERGENCY":
      return 3;
    case "HIGH":
      return 2;
    case "NORMAL":
      return 1;
  }
};

/** Earlier deadlines receive larger, deterministic buckets. */
export const deadlineWeight = (requiredAt: Date, now: Date): number => {
  const hoursRemaining =
    (requiredAt.getTime() - now.getTime()) / millisecondsPerHour;
  if (!Number.isFinite(hoursRemaining)) return 0;
  if (hoursRemaining <= 0) return 4;
  if (hoursRemaining <= 6) return 3;
  if (hoursRemaining <= 24) return 2;
  if (hoursRemaining <= 72) return 1;
  return 0;
};

export const calculateMatchScore = ({
  urgency,
  requiredAt,
  now,
  distanceKm,
  daysSinceLastDonation,
  recentInvitationCount,
}: MatchScoreInput): number => {
  const score =
    urgencyWeight(urgency) * 1_000 +
    deadlineWeight(requiredAt, now) * 100 -
    distanceKm * 10 +
    daysSinceLastDonation * 0.1 -
    recentInvitationCount * 20;

  return Math.round(score * 1_000) / 1_000;
};

export const calculatePriorityScore = calculateMatchScore;

export type RankedMatch = Readonly<{
  donorId: number;
  score: number;
  distanceKm: number | null;
}>;

export const compareRankedMatches = (left: RankedMatch, right: RankedMatch) =>
  right.score - left.score ||
  (left.distanceKm ?? Number.POSITIVE_INFINITY) -
    (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
  left.donorId - right.donorId;
