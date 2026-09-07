import { z } from "zod";
import { NotificationType } from "../../generated/prisma/enums.js";

const emptyObjectSchema = z.object({}).strict().default({});

export const notificationListValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
        unread: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
        type: z.enum(NotificationType).optional(),
      })
      .strict(),
  })
  .strict();

export const notificationIdValidationSchema = z
  .object({
    params: z.object({ id: z.coerce.number().int().min(1) }).strict(),
    body: emptyObjectSchema,
    query: emptyObjectSchema,
  })
  .strict();

export const notificationReadAllValidationSchema = z
  .object({
    params: emptyObjectSchema,
    body: emptyObjectSchema,
    query: emptyObjectSchema,
  })
  .strict();
