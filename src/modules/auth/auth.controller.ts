import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { authService } from "./auth.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppError } from "../../errors/AppError";
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

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User logged in successfully",
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  },
);

const refreshToken = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const token =
      req.cookies?.[refreshTokenCookieName];

    if (!token) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is required");
    }

    const result = await authService.refreshToken(token);

    res.cookie(refreshTokenCookieName, result.refreshToken, cookieOptions);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Access token generated successfully",
      data: {
        accessToken: result.accessToken,
      },
    });
  },
);

const logoutUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[refreshTokenCookieName];

    if (token) {
      await authService.logoutUser(token);
    }

    res.clearCookie(refreshTokenCookieName, cookieOptions);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User logged out successfully",
      data: null,
    });
  },
);

export const authController = {
  loginUser,
  refreshToken,
  logoutUser,
};
