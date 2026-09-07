import { phoneSchema } from "../../shared/validation.js";
import { z } from "zod";
import { BloodType } from "../../generated/prisma/enums.js";

export const updatePatientProfileValidationSchema = z.object({
  body: z
    .object({
      bloodType: z.enum(BloodType).optional(),
      emergencyContactName: z
        .string()
        .trim()
        .min(2)
        .max(120)
        .nullable()
        .optional(),
      emergencyContactPhone: phoneSchema.nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one patient profile field is required",
    }),
});
