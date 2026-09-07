import express, { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { checkoutCreationRateLimit } from "../../middlewares/rateLimit.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { paymentController } from "./payment.controller.js";
import {
  createCheckoutValidationSchema,
  paymentIdValidationSchema,
  paymentListValidationSchema,
} from "./payment.validation.js";

const webhookRouter: Router = Router();
webhookRouter.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  paymentController.handleWebhook,
);

const router: Router = Router();

router.post(
  "/payments/checkout-sessions",
  auth(Role.PATIENT, Role.DONOR),
  checkoutCreationRateLimit,
  validateRequest(createCheckoutValidationSchema),
  paymentController.createCheckoutSession,
);
router.get(
  "/payments/mine",
  auth(Role.PATIENT, Role.DONOR),
  validateRequest(paymentListValidationSchema),
  paymentController.listMyPayments,
);
router.get(
  "/payments/:id",
  auth(Role.PATIENT, Role.DONOR, Role.ADMIN),
  validateRequest(paymentIdValidationSchema),
  paymentController.getPayment,
);
router.post(
  "/payments/:id/cancel",
  auth(Role.PATIENT, Role.DONOR, Role.ADMIN),
  validateRequest(paymentIdValidationSchema),
  paymentController.cancelPayment,
);
router.post(
  "/payments/:id/refund",
  auth(Role.ADMIN),
  validateRequest(paymentIdValidationSchema),
  paymentController.refundPayment,
);

export const paymentRoutes: Router = router;
export const paymentWebhookRoutes: Router = webhookRouter;
