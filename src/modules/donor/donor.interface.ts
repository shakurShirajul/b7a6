import { z } from "zod";
import {
  donationHistoryValidationSchema,
  updateDonorAvailabilityValidationSchema,
  updateDonorProfileValidationSchema,
} from "./donor.validation.js";

export type UpdateDonorProfilePayload = z.infer<
  typeof updateDonorProfileValidationSchema
>["body"];
export type UpdateDonorAvailabilityPayload = z.infer<
  typeof updateDonorAvailabilityValidationSchema
>["body"];
export type DonationHistoryQuery = z.infer<
  typeof donationHistoryValidationSchema
>["query"];
