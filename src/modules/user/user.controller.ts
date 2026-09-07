import { requireCurrentUser } from "../../shared/request-user.js";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { userService } from "./user.service.js";

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = await userService.getMyProfile(requireCurrentUser(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User profile retrieved successfully",
    data: user,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = await userService.updateMyProfile(
    requireCurrentUser(req),
    req.body,
    { ipAddress: req.ip, userAgent: req.get("user-agent") },
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User profile updated successfully",
    data: user,
  });
});

export const userController = {
  getMyProfile,
  updateMyProfile,
};
