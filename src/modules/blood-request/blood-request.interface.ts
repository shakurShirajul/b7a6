import { z } from "zod";
import type { Role } from "../../generated/prisma/enums.js";
import {
  bloodRequestListValidationSchema,
  createBloodRequestValidationSchema,
  updateBloodRequestValidationSchema,
  verifyBloodRequestValidationSchema,
} from "./blood-request.validation.js";

export type CurrentBloodRequestUser = {
  userId: number;
  role: Role;
};

export type CreateBloodRequestPayload = z.infer<
  typeof createBloodRequestValidationSchema
>["body"];

export type UpdateBloodRequestPayload = z.infer<
  typeof updateBloodRequestValidationSchema
>["body"];

export type BloodRequestListQuery = z.infer<
  typeof bloodRequestListValidationSchema
>["query"];

export type VerifyBloodRequestPayload = z.infer<
  typeof verifyBloodRequestValidationSchema
>["body"];
