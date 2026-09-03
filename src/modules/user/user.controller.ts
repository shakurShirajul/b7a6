import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { userService } from "./user.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status"

const getAllUsers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
});

const getUserById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
});

const createUser = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const payload = req.body;
  const user = await userService.registerIntoDB(payload);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "User created successfully",
    data: user,
  });
});

export const userController = {
  getAllUsers,
  getUserById,
  createUser,
};
