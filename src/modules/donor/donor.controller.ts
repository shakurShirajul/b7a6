import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { donorService } from "./donor.service.js";

const requireCurrentUserId = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }

  return req.user.userId;
};

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await donorService.getMyProfile(requireCurrentUserId(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor profile retrieved successfully",
    data: profile,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await donorService.updateMyProfile(
    requireCurrentUserId(req),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor profile updated successfully",
    data: profile,
  });
});

const updateMyAvailability = catchAsync(async (req: Request, res: Response) => {
  const profile = await donorService.updateMyAvailability(
    requireCurrentUserId(req),
    req.body,
    requestContext(req),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donor availability updated successfully",
    data: profile,
  });
});

const getMyDonations = catchAsync(async (req: Request, res: Response) => {
  const result = await donorService.getMyDonations(
    requireCurrentUserId(req),
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Donation history retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const donorController = {
  getMyProfile,
  updateMyProfile,
  updateMyAvailability,
  getMyDonations,
};
