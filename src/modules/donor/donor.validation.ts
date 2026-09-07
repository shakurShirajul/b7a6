import { z } from "zod";
import { BloodType } from "../../generated/prisma/enums.js";

const requireCoordinateUpdatePair = (
  value: { latitude?: number | null; longitude?: number | null },
  context: z.RefinementCtx,
) => {
  const hasLatitude = Object.prototype.hasOwnProperty.call(value, "latitude");
  const hasLongitude = Object.prototype.hasOwnProperty.call(value, "longitude");
  if (!hasLatitude && !hasLongitude) return;

  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: "custom",
      path: hasLatitude ? ["longitude"] : ["latitude"],
      message: "Latitude and longitude must be updated together",
    });
    return;
  }

  const bothNull = value.latitude === null && value.longitude === null;
  const bothNumbers =
    typeof value.latitude === "number" && typeof value.longitude === "number";
  if (!bothNull && !bothNumbers) {
    context.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "Coordinates must both be valid values or both be null",
    });
  }
};

export const updateDonorProfileValidationSchema = z.object({
  body: z
    .object({
      bloodType: z.enum(BloodType).optional(),
      weightKg: z.coerce.number().min(40).max(300).optional(),
      division: z.string().trim().min(1).max(100).optional(),
      district: z.string().trim().min(1).max(100).optional(),
      area: z.string().trim().min(1).max(160).optional(),
      latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
      longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one donor profile field is required",
    })
    .superRefine(requireCoordinateUpdatePair),
});

export const updateDonorAvailabilityValidationSchema = z.object({
  body: z.object({ isAvailable: z.boolean() }).strict(),
});

export const donationHistoryValidationSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    })
    .strict(),
});
