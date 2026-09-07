import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { notificationService } from "./notification.service.js";

const currentUserId = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }
  return req.user.userId;
};

const listOwnNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await notificationService.listOwnNotifications(
    currentUserId(req),
    req.query as never,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const markAllOwnRead = catchAsync(async (req: Request, res: Response) => {
  const result = await notificationService.markAllOwnRead(currentUserId(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications marked as read",
    data: result,
  });
});

const markOwnRead = catchAsync(async (req: Request, res: Response) => {
  const notification = await notificationService.markOwnRead(
    currentUserId(req),
    Number(req.params.id),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification marked as read",
    data: notification,
  });
});

export const notificationController = {
  listOwnNotifications,
  markAllOwnRead,
  markOwnRead,
};
