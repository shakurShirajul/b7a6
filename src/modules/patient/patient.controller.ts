import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { patientService } from "./patient.service.js";

const requireCurrentUserId = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }

  return req.user.userId;
};

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await patientService.getMyProfile(requireCurrentUserId(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient profile retrieved successfully",
    data: profile,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await patientService.updateMyProfile(
    requireCurrentUserId(req),
    req.body,
    { ipAddress: req.ip, userAgent: req.get("user-agent") },
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient profile updated successfully",
    data: profile,
  });
});

export const patientController = {
  getMyProfile,
  updateMyProfile,
};
