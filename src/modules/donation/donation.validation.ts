import { z } from "zod";

const emptyObjectSchema = z.object({}).strict().default({});

export const completeDonationValidationSchema = z
  .object({
    body: z
      .object({
        unitCount: z.literal(1).default(1),
        donatedAt: z.coerce
          .date()
          .refine((value) => value <= new Date(), {
            message: "Donation time cannot be in the future",
          })
          .optional(),
        notes: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .default({ unitCount: 1 }),
    params: z
      .object({
        id: z.coerce.number().int().positive(),
      })
      .strict(),
    query: emptyObjectSchema,
  })
  .strict();
