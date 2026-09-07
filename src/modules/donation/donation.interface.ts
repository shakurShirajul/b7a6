import type { z } from "zod";
import type { completeDonationValidationSchema } from "./donation.validation.js";

export type CompleteDonationPayload = z.infer<
  typeof completeDonationValidationSchema
>["body"];
