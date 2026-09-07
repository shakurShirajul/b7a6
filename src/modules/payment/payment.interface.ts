import { z } from "zod";
import type { Role } from "../../generated/prisma/enums.js";
import {
  createCheckoutValidationSchema,
  paymentListValidationSchema,
} from "./payment.validation.js";

export type CurrentPaymentUser = {
  userId: number;
  role: Role;
};

export type CreateCheckoutPayload = z.infer<
  typeof createCheckoutValidationSchema
>["body"];

export type PaymentListQuery = z.infer<
  typeof paymentListValidationSchema
>["query"];

export type PaymentRequestContext = {
  ipAddress?: string;
  userAgent?: string;
};
