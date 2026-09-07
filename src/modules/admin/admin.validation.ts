import { z } from "zod";
import config from "../../config/index.js";
import {
  BloodType,
  Role,
  UserStatus,
  VerificationStatus,
} from "../../generated/prisma/enums.js";

const idParamsSchema = z
  .object({ id: z.coerce.number().int().min(1) })
  .strict();
const emptyObjectSchema = z.object({}).strict().default({});

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/, "Phone number contains invalid characters");

const latitudeSchema = z.coerce.number().min(-90).max(90).nullable();
const longitudeSchema = z.coerce.number().min(-180).max(180).nullable();

const requireCoordinatePair = (
  value: { latitude?: number | null; longitude?: number | null },
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
    return;
  }
  if (!hasLatitude) return;
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

const validateDateRange = (
  value: { from?: Date; to?: Date },
  context: z.RefinementCtx,
) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "The end date must be on or after the start date",
    });
  }
};

export const adminUserListValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
        q: z.string().trim().min(1).max(120).optional(),
        role: z.enum(Role).optional(),
        status: z.enum(UserStatus).optional(),
        sortBy: z.enum(["createdAt", "name", "email"]).default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      })
      .strict(),
  })
  .strict();

export const adminUserStatusValidationSchema = z
  .object({
    params: idParamsSchema,
    body: z.object({ status: z.enum(UserStatus) }).strict(),
    query: emptyObjectSchema,
  })
  .strict();

const hospitalFields = {
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().min(3).max(500),
  contactPhone: phoneSchema,
  contactEmail: z.email().trim().toLowerCase().nullable().optional(),
  division: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  area: z.string().trim().min(1).max(160),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
};

export const adminHospitalCreateValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: z
      .object({
        ...hospitalFields,
        verificationStatus: z
          .enum([VerificationStatus.PENDING, VerificationStatus.VERIFIED])
          .default(VerificationStatus.PENDING),
      })
      .strict()
      .superRefine(requireCoordinatePair),
    query: emptyObjectSchema,
  })
  .strict();

const hospitalUpdateActionSchema = z.object({
  action: z.literal("UPDATE"),
  name: hospitalFields.name.optional(),
  address: hospitalFields.address.optional(),
  contactPhone: hospitalFields.contactPhone.optional(),
  contactEmail: hospitalFields.contactEmail,
  division: hospitalFields.division.optional(),
  district: hospitalFields.district.optional(),
  area: hospitalFields.area.optional(),
  latitude: hospitalFields.latitude,
  longitude: hospitalFields.longitude,
});

const hospitalVerifyActionSchema = z.object({
  action: z.literal("VERIFY"),
  decision: z.enum([VerificationStatus.VERIFIED, VerificationStatus.REJECTED]),
  reasonCode: z.string().trim().min(1).max(120).optional(),
});

const hospitalDeleteActionSchema = z.object({
  action: z.literal("DELETE"),
});

export const adminHospitalUpdateValidationSchema = z
  .object({
    params: idParamsSchema,
    body: z
      .discriminatedUnion("action", [
        hospitalUpdateActionSchema.strict(),
        hospitalVerifyActionSchema.strict(),
        hospitalDeleteActionSchema.strict(),
      ])
      .superRefine((body, context) => {
        if (body.action === "UPDATE") {
          if (Object.keys(body).length === 1) {
            context.addIssue({
              code: "custom",
              message: "At least one hospital field is required",
            });
          }
          requireCoordinatePair(body, context);
        }
        if (
          body.action === "VERIFY" &&
          body.decision === VerificationStatus.REJECTED &&
          !body.reasonCode
        ) {
          context.addIssue({
            code: "custom",
            path: ["reasonCode"],
            message: "A rejection reason is required when rejecting",
          });
        }
      }),
    query: emptyObjectSchema,
  })
  .strict();

export const donorAssessmentReasonCodes = [
  "CLEARED",
  "TEMPORARILY_DEFERRED",
  "AGE_NOT_ELIGIBLE",
  "WEIGHT_BELOW_MINIMUM",
  "RECENT_DONATION",
  "DOCUMENTATION_INCOMPLETE",
  "PROFILE_REJECTED",
] as const;

export const adminDonorVerifyValidationSchema = z
  .object({
    params: idParamsSchema,
    body: z
      .object({
        decision: z.enum([
          VerificationStatus.VERIFIED,
          VerificationStatus.REJECTED,
        ]),
        isEligible: z.boolean(),
        reasonCode: z.enum(donorAssessmentReasonCodes).optional(),
        expiresAt: z.coerce.date(),
      })
      .strict()
      .superRefine((body, context) => {
        const now = new Date();
        const latestAllowed = new Date(now);
        latestAllowed.setUTCFullYear(latestAllowed.getUTCFullYear() + 1);
        if (body.expiresAt <= now || body.expiresAt > latestAllowed) {
          context.addIssue({
            code: "custom",
            path: ["expiresAt"],
            message: "Assessment expiry must be within the next year",
          });
        }
        if (body.decision === VerificationStatus.REJECTED && body.isEligible) {
          context.addIssue({
            code: "custom",
            path: ["isEligible"],
            message: "A rejected donor profile cannot be eligible",
          });
        }
        if (!body.isEligible && !body.reasonCode) {
          context.addIssue({
            code: "custom",
            path: ["reasonCode"],
            message: "A controlled reason code is required when ineligible",
          });
        }
        if (
          body.isEligible &&
          body.reasonCode !== undefined &&
          body.reasonCode !== "CLEARED"
        ) {
          context.addIssue({
            code: "custom",
            path: ["reasonCode"],
            message:
              "Eligible assessments may only use the CLEARED reason code",
          });
        }
        if (
          body.decision === VerificationStatus.VERIFIED &&
          !body.isEligible &&
          body.reasonCode === "PROFILE_REJECTED"
        ) {
          context.addIssue({
            code: "custom",
            path: ["reasonCode"],
            message:
              "Verified profiles cannot use the profile rejection reason",
          });
        }
        if (
          body.decision === VerificationStatus.REJECTED &&
          body.reasonCode !== "PROFILE_REJECTED" &&
          body.reasonCode !== "DOCUMENTATION_INCOMPLETE"
        ) {
          context.addIssue({
            code: "custom",
            path: ["reasonCode"],
            message: "Rejected profiles require a rejection reason code",
          });
        }
      }),
    query: emptyObjectSchema,
  })
  .strict();

export const adminRematchValidationSchema = z
  .object({
    params: idParamsSchema,
    body: z
      .object({
        radiusKm: z
          .number()
          .refine(
            (radius) =>
              radius === config.matching.default_radius_km ||
              radius === config.matching.max_radius_km,
            `Radius must be ${config.matching.default_radius_km} or ${config.matching.max_radius_km} km`,
          )
          .default(config.matching.max_radius_km),
      })
      .strict()
      .default({ radiusKm: config.matching.max_radius_km }),
    query: emptyObjectSchema,
  })
  .strict();

export const adminDashboardValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .strict()
      .superRefine(validateDateRange),
  })
  .strict();

export const adminDonationReportValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        bloodType: z.enum(BloodType).optional(),
        division: z.string().trim().min(1).max(100).optional(),
        district: z.string().trim().min(1).max(100).optional(),
        area: z.string().trim().min(1).max(160).optional(),
      })
      .strict()
      .superRefine(validateDateRange),
  })
  .strict();

export const adminAuditLogValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
        actorId: z.coerce.number().int().min(1).optional(),
        action: z.string().trim().min(1).max(100).optional(),
        entityType: z.string().trim().min(1).max(100).optional(),
        entityId: z.string().trim().min(1).max(120).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      })
      .strict()
      .superRefine(validateDateRange),
  })
  .strict();
