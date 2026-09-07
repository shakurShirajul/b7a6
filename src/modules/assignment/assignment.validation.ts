import { z } from "zod";
import { AssignmentStatus } from "../../generated/prisma/enums.js";

const emptyObjectSchema = z.object({}).strict().default({});
const assignmentIdParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

export const assignmentListValidationSchema = z.object({
  body: emptyObjectSchema,
  params: emptyObjectSchema,
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      status: z.enum(AssignmentStatus).optional(),
    })
    .strict(),
});

export const acceptAssignmentValidationSchema = z.object({
  body: emptyObjectSchema,
  params: assignmentIdParamsSchema,
  query: emptyObjectSchema,
});

export const assignmentDeclineReasonCodes = [
  "TEMPORARILY_UNAVAILABLE",
  "SCHEDULING_CONFLICT",
  "TRAVEL_CONSTRAINT",
  "PERSONAL_REASON",
] as const;

export const rejectAssignmentValidationSchema = z.object({
  body: z
    .object({
      reasonCode: z.enum(assignmentDeclineReasonCodes),
    })
    .strict(),
  params: assignmentIdParamsSchema,
  query: emptyObjectSchema,
});
