import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { userService } from "./user.service.js";

const requireCurrentUser = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }
  return req.user;
};

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
