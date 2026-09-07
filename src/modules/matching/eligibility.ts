import { getCompatibleDonorTypes, type BloodType } from "./compatibility.js";

export type EligibilityPolicy = {
  minAgeYears: number;
  maxAgeYears: number;
  minWeightKg: number;
  minDonationIntervalDays: number;
};

export type DonorEligibilityAssessment = {
  isEligible: boolean;
  checkedAt: Date;
  expiresAt: Date;
};

export type DonorRequestEligibilityContext = {
  recipientBloodType: BloodType;
  /** Status of the donor's existing assignment for this recipient request. */
  assignmentStatus:
    | "INVITED"
    | "ACCEPTED"
    | "DECLINED"
    | "EXPIRED"
    | "CANCELLED"
    | "COMPLETED"
    | null;
};

export type DonorEligibilityInput = {
  userStatus: "ACTIVE" | "SUSPENDED";
  userDeletedAt: Date | null;
  dateOfBirth: Date | null;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  isAvailable: boolean;
  bloodType: BloodType;
  weightKg: number;
  lastDonationDate: Date | null;
  latestAssessment: DonorEligibilityAssessment | null;
  reservationExpiresAt: Date | null;
  requestContext?: DonorRequestEligibilityContext | null;
};

export type DonorEligibilityReasonCode =
  | "USER_INACTIVE"
  | "USER_DELETED"
  | "DONOR_UNVERIFIED"
  | "UNAVAILABLE"
  | "INCOMPATIBLE_BLOOD_TYPE"
  | "DATE_OF_BIRTH_MISSING"
  | "DATE_OF_BIRTH_INVALID"
  | "AGE_BELOW_MINIMUM"
  | "AGE_ABOVE_MAXIMUM"
  | "WEIGHT_BELOW_MINIMUM"
  | "TOO_RECENT"
  | "ASSESSMENT_MISSING"
  | "ASSESSMENT_INELIGIBLE"
  | "ASSESSMENT_NOT_CURRENT"
  | "ASSESSMENT_EXPIRED"
  | "ACTIVE_RESERVATION"
  | "REQUEST_ALREADY_ASSIGNED"
  | "ALREADY_INVITED"
  | "ALREADY_DECLINED"
  | "ALREADY_COMPLETED";

export type EligibilityResult = {
  isEligible: boolean;
  reasonCodes: readonly DonorEligibilityReasonCode[];
  assessmentCheckedAt: Date | null;
  assessmentExpiresAt: Date | null;
  hasActiveReservation: boolean;
};

const millisecondsPerDay = 24 * 60 * 60 * 1000;

const calculateAge = (dateOfBirth: Date, now: Date) => {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const birthdayHasNotOccurred =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate());

  if (birthdayHasNotOccurred) age -= 1;
  return age;
};

const hasValidTime = (date: Date) => Number.isFinite(date.getTime());

export const evaluateDonorEligibility = (
  donor: DonorEligibilityInput,
  policy: EligibilityPolicy,
  now: Date,
): EligibilityResult => {
  const reasonCodes: DonorEligibilityReasonCode[] = [];
  const latestAssessment = donor.latestAssessment;
  const hasActiveReservation = Boolean(
    donor.reservationExpiresAt &&
    hasValidTime(donor.reservationExpiresAt) &&
    donor.reservationExpiresAt > now,
  );

  if (donor.userStatus !== "ACTIVE") reasonCodes.push("USER_INACTIVE");
  if (donor.userDeletedAt) reasonCodes.push("USER_DELETED");
  if (donor.verificationStatus !== "VERIFIED") {
    reasonCodes.push("DONOR_UNVERIFIED");
  }
  if (!donor.isAvailable) reasonCodes.push("UNAVAILABLE");

  if (
    donor.requestContext &&
    !getCompatibleDonorTypes(donor.requestContext.recipientBloodType).includes(
      donor.bloodType,
    )
  ) {
    reasonCodes.push("INCOMPATIBLE_BLOOD_TYPE");
  }

  if (!donor.dateOfBirth) {
    reasonCodes.push("DATE_OF_BIRTH_MISSING");
  } else if (!hasValidTime(donor.dateOfBirth)) {
    reasonCodes.push("DATE_OF_BIRTH_INVALID");
  } else {
    const age = calculateAge(donor.dateOfBirth, now);
    if (age < policy.minAgeYears) reasonCodes.push("AGE_BELOW_MINIMUM");
    if (age > policy.maxAgeYears) reasonCodes.push("AGE_ABOVE_MAXIMUM");
  }

  if (donor.weightKg < policy.minWeightKg) {
    reasonCodes.push("WEIGHT_BELOW_MINIMUM");
  }

  if (donor.lastDonationDate) {
    const intervalCutoff = new Date(
      now.getTime() - policy.minDonationIntervalDays * millisecondsPerDay,
    );
    if (
      !hasValidTime(donor.lastDonationDate) ||
      donor.lastDonationDate > intervalCutoff
    ) {
      reasonCodes.push("TOO_RECENT");
    }
  }

  if (!latestAssessment) {
    reasonCodes.push("ASSESSMENT_MISSING");
  } else {
    if (!latestAssessment.isEligible) {
      reasonCodes.push("ASSESSMENT_INELIGIBLE");
    }
    if (
      !hasValidTime(latestAssessment.checkedAt) ||
      latestAssessment.checkedAt > now
    ) {
      reasonCodes.push("ASSESSMENT_NOT_CURRENT");
    }
    if (
      !hasValidTime(latestAssessment.expiresAt) ||
      latestAssessment.expiresAt <= now
    ) {
      reasonCodes.push("ASSESSMENT_EXPIRED");
    }
  }

  if (hasActiveReservation) reasonCodes.push("ACTIVE_RESERVATION");

  const assignmentStatus = donor.requestContext?.assignmentStatus;
  if (assignmentStatus) {
    reasonCodes.push("REQUEST_ALREADY_ASSIGNED");
  }

  switch (assignmentStatus) {
    case "INVITED":
      reasonCodes.push("ALREADY_INVITED");
      break;
    case "DECLINED":
      reasonCodes.push("ALREADY_DECLINED");
      break;
    case "COMPLETED":
      reasonCodes.push("ALREADY_COMPLETED");
      break;
    default:
      break;
  }

  return {
    isEligible: reasonCodes.length === 0,
    reasonCodes,
    assessmentCheckedAt: latestAssessment?.checkedAt ?? null,
    assessmentExpiresAt: latestAssessment?.expiresAt ?? null,
    hasActiveReservation,
  };
};
