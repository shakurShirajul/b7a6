import type { EligibilityResult } from "../matching/eligibility.js";

export { evaluateDonorEligibility } from "../matching/eligibility.js";

export const isDonorEffectivelyAvailable = (
  storedAvailability: boolean,
  eligibility: EligibilityResult,
) => storedAvailability && eligibility.isEligible;
