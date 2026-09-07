import { phoneSchema } from "../../shared/validation.js";
import { z } from "zod";
import { Gender } from "../../generated/prisma/enums.js";

export const updateMyProfileValidationSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: phoneSchema.optional(),
      avatar: z.url().nullable().optional(),
      dateOfBirth: z.coerce.date().max(new Date()).nullable().optional(),
      gender: z.enum(Gender).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one profile field is required",
    }),
});
