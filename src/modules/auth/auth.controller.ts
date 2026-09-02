import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { authService } from "./auth.service";

const refreshTokenCookieName = "refreshToken";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

const loginUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;

    const result = await authService.loginUser(payload);

    res.cookie(refreshTokenCookieName, result.refreshToken, cookieOptions);

    res.status(200).json({
      success: true,
      message: "User logged in successfully",
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  },
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
