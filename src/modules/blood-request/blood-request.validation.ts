import { z } from "zod";
import {
  BloodRequestStatus,
  BloodType,
  Urgency,
  VerificationStatus,
} from "../../generated/prisma/enums.js";

const emptyObjectSchema = z.object({}).strict().default({});

const locationShape = {
  division: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  area: z.string().trim().min(1).max(160),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
};

const requireCoordinatePair = (
  value: { latitude?: number | null; longitude?: number | null },
  context: z.RefinementCtx,
) => {
  const hasLatitude = value.latitude !== undefined && value.latitude !== null;
  const hasLongitude =
    value.longitude !== undefined && value.longitude !== null;

  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: "custom",
      path: hasLatitude ? ["longitude"] : ["latitude"],
      message: "Latitude and longitude must be provided together",
    });
  }
};

const requireCoordinateUpdatePair = (
  value: { latitude?: number | null; longitude?: number | null },
  context: z.RefinementCtx,
) => {
  const hasLatitudeKey = Object.prototype.hasOwnProperty.call(
    value,
    "latitude",
  );
  const hasLongitudeKey = Object.prototype.hasOwnProperty.call(
    value,
    "longitude",
  );

  if (!hasLatitudeKey && !hasLongitudeKey) return;

  if (hasLatitudeKey !== hasLongitudeKey) {
    context.addIssue({
      code: "custom",
      path: hasLatitudeKey ? ["longitude"] : ["latitude"],
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

const futureDateSchema = z.coerce.date().refine((date) => date > new Date(), {
  message: "Required date must be in the future",
});

export const createBloodRequestValidationSchema = z.object({
  body: z
    .object({
      hospitalId: z.coerce.number().int().min(1),
      bloodType: z.enum(BloodType),
      unitsRequired: z.coerce.number().int().min(1).max(100),
      urgency: z.enum(Urgency).optional(),
      description: z.string().trim().min(1).max(1000).nullable().optional(),
      proofUrl: z.url().max(2048).nullable().optional(),
      requiredAt: futureDateSchema,
      ...locationShape,
    })
    .strict()
    .superRefine(requireCoordinatePair),
});

export const updateBloodRequestValidationSchema = z.object({
  params: z.object({ id: z.coerce.number().int().min(1) }).strict(),
  body: z
    .object({
      hospitalId: z.coerce.number().int().min(1).optional(),
      bloodType: z.enum(BloodType).optional(),
      unitsRequired: z.coerce.number().int().min(1).max(100).optional(),
      urgency: z.enum(Urgency).optional(),
      description: z.string().trim().min(1).max(1000).nullable().optional(),
      proofUrl: z.url().max(2048).nullable().optional(),
      requiredAt: futureDateSchema.optional(),
      division: locationShape.division.optional(),
      district: locationShape.district.optional(),
      area: locationShape.area.optional(),
      latitude: locationShape.latitude,
      longitude: locationShape.longitude,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one blood request field is required",
    })
    .superRefine(requireCoordinateUpdatePair),
});

export const bloodRequestIdValidationSchema = z.object({
  params: z.object({ id: z.coerce.number().int().min(1) }).strict(),
});

export const bloodRequestListValidationSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      q: z.string().trim().min(1).max(120).optional(),
      status: z.enum(BloodRequestStatus).optional(),
      urgency: z.enum(Urgency).optional(),
      bloodType: z.enum(BloodType).optional(),
      hospitalId: z.coerce.number().int().min(1).optional(),
      division: z.string().trim().min(1).max(100).optional(),
      district: z.string().trim().min(1).max(100).optional(),
      area: z.string().trim().min(1).max(160).optional(),
      sortBy: z
        .enum(["createdAt", "updatedAt", "requiredAt", "unitsRequired"])
        .default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .strict(),
});

export const verifyBloodRequestValidationSchema = z
  .object({
    params: z.object({ id: z.coerce.number().int().min(1) }).strict(),
    body: z
      .object({
        decision: z.enum([
          VerificationStatus.VERIFIED,
          VerificationStatus.REJECTED,
        ]),
        reasonCode: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    query: emptyObjectSchema,
  })
  .strict();
