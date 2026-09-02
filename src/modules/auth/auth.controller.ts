import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";

const loginUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {},
);
const refreshToken = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {},
);
const logoutUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {},
);

export const authController = {
  loginUser,
  refreshToken,
  logoutUser,
};
