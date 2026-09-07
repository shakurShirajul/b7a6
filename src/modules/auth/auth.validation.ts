import { phoneSchema } from "../../shared/validation.js";
import { z } from "zod";
import { BloodType, Gender, Role } from "../../generated/prisma/enums.js";

const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

const requireCoordinatePair = (
  value: { latitude?: number; longitude?: number },
  context: z.RefinementCtx,
) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: "custom",
      path: hasLatitude ? ["longitude"] : ["latitude"],
      message: "Latitude and longitude must be provided together",
    });
  }
};

const registrationBase = {
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  password: passwordSchema,
  phone: phoneSchema,
  avatar: z.url().optional(),
  dateOfBirth: z.coerce.date().max(new Date()).optional(),
  gender: z.enum(Gender).optional(),
  bloodType: z.enum(BloodType),
};

const patientRegistrationSchema = z
  .object({
    ...registrationBase,
    role: z.literal(Role.PATIENT),
    emergencyContactName: z.string().trim().min(2).max(120).optional(),
    emergencyContactPhone: phoneSchema.optional(),
  })
  .strict();

const donorRegistrationSchema = z
  .object({
    ...registrationBase,
    role: z.literal(Role.DONOR),
    weightKg: z.coerce.number().min(40).max(300),
    division: z.string().trim().min(1).max(100),
    district: z.string().trim().min(1).max(100),
    area: z.string().trim().min(1).max(160),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine(requireCoordinatePair);

export const registerValidationSchema = z.object({
  body: z.discriminatedUnion("role", [
    patientRegistrationSchema,
    donorRegistrationSchema,
  ]),
});

export const loginValidationSchema = z.object({
  body: z
    .object({
      email: z.email().trim().toLowerCase(),
      password: z.string().min(1).max(128),
    })
    .strict(),
});

export const googleCallbackValidationSchema = z.object({
  query: z
    .object({
      code: z.string().trim().min(1).optional(),
      state: z.string().trim().min(1).optional(),
      error: z.string().trim().min(1).optional(),
    })
    .passthrough()
    .superRefine((query, context) => {
      if (!query.error && (!query.code || !query.state)) {
        context.addIssue({
          code: "custom",
          message: "Google callback requires code and state",
        });
      }
    }),
});
