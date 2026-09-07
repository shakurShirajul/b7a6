import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { donationService } from "./donation.service.js";

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const completeDonation = catchAsync(async (req: Request, res: Response) => {
  const result = await donationService.completeDonation(
    requireCurrentUser(req).userId,
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
