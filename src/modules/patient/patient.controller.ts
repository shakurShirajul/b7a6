import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { patientService } from "./patient.service.js";

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await patientService.getMyProfile(
    requireCurrentUser(req).userId,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient profile retrieved successfully",
    data: profile,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const profile = await patientService.updateMyProfile(
    requireCurrentUser(req).userId,
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
