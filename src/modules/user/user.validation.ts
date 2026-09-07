import { z } from "zod";
import { Gender } from "../../generated/prisma/enums.js";

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/, "Phone number contains invalid characters");

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
