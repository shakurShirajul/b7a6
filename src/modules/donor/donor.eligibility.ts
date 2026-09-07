import type { EligibilityResult } from "../matching/eligibility.js";

export {
  type DonorEligibilityInput as DonorEligibilityCandidate,
  type EligibilityPolicy as DonorEligibilityPolicy,
  type EligibilityResult as DonorEligibilityResult,
  evaluateDonorEligibility,
} from "../matching/eligibility.js";

export const isDonorEffectivelyAvailable = (
  storedAvailability: boolean,
  eligibility: EligibilityResult,
) => storedAvailability && eligibility.isEligible;
