import { z } from "zod";

export const hospitalListValidationSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      q: z.string().trim().min(1).max(120).optional(),
      division: z.string().trim().min(1).max(100).optional(),
      district: z.string().trim().min(1).max(100).optional(),
      area: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
});

export const hospitalDetailsValidationSchema = z.object({
  params: z.object({ id: z.coerce.number().int().min(1) }).strict(),
});
