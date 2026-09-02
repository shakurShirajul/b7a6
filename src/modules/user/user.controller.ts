import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";

const getAllUsers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
});

const getUserById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
});

export const userController = {
  getAllUsers,
  getUserById,
};
