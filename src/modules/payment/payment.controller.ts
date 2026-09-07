import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { paymentService } from "./payment.service.js";

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const createCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const result = await paymentService.createCheckoutSession(
      requireCurrentUser(req),
      req.body,
      requestContext(req),
    );
    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Checkout Session created successfully",
      data: result,
    });
  },
);

const handleWebhook = catchAsync(async (req: Request, res: Response) => {
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Stripe webhook requires a raw request body",
    );
  }
  const signature = req.get("stripe-signature");
  if (!signature) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Stripe-Signature header is required",
    );
  }

  const result = await paymentService.handleWebhook(req.body, signature);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stripe webhook received",
    data: result,
  });
});

const cancelPayment = catchAsync(async (req: Request, res: Response) => {
  const payment = await paymentService.cancelPayment(
    requireCurrentUser(req),
    Number(req.params.id),
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment checkout cancelled successfully",
    data: payment,
  });
});

const refundPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await paymentService.refundPayment(
    requireCurrentUser(req),
    Number(req.params.id),
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.ACCEPTED,
    success: true,
    message: "Payment refund requested successfully",
    data: result,
  });
});

const getPayment = catchAsync(async (req: Request, res: Response) => {
  const payment = await paymentService.getPayment(
    requireCurrentUser(req),
    Number(req.params.id),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment retrieved successfully",
    data: payment,
  });
});

const listMyPayments = catchAsync(async (req: Request, res: Response) => {
  const result = await paymentService.listMyPayments(
    requireCurrentUser(req).userId,
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Your payments were retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const paymentController = {
  createCheckoutSession,
  handleWebhook,
  cancelPayment,
  refundPayment,
  getPayment,
  listMyPayments,
};
