import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { donationService } from "./donation.service.js";

const requireCurrentAdminId = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }
  return req.user.userId;
};

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const completeDonation = catchAsync(async (req: Request, res: Response) => {
  const result = await donationService.completeDonation(
    requireCurrentAdminId(req),
    Number(req.params.id),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.alreadyCompleted
      ? "Donation was already completed"
      : "Donation completed successfully",
    data: result,
  });
});

export const donationController = { completeDonation };
