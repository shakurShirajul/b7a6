import { z } from "zod";
import { PaymentPurpose, PaymentStatus } from "../../generated/prisma/enums.js";

const emptyObjectSchema = z.object({}).strict().default({});
const paymentIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

const majorUnitAmountSchema = z
  .union([
    z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
    z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, {
        message: "Amount must be a positive decimal value",
      }),
  ])
  .transform((value) => String(value));

const normalizedCurrencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter code")
  .transform((value) => value.toUpperCase());

export const createCheckoutValidationSchema = z.object({
  body: z
    .object({
      purpose: z.enum(PaymentPurpose),
      amount: majorUnitAmountSchema,
      currency: normalizedCurrencySchema,
      bloodRequestId: z.coerce.number().int().positive().optional(),
    })
    .strict(),
  params: emptyObjectSchema,
  query: emptyObjectSchema,
});

export const paymentIdValidationSchema = z.object({
  body: emptyObjectSchema,
  params: paymentIdParamsSchema,
  query: emptyObjectSchema,
});

export const paymentListValidationSchema = z.object({
  body: emptyObjectSchema,
  params: emptyObjectSchema,
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      status: z.enum(PaymentStatus).optional(),
      purpose: z.enum(PaymentPurpose).optional(),
    })
    .strict(),
});
