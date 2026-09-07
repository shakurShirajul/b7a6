import type { CookieOptions, Request, Response } from "express";
import httpStatus from "http-status";
import ms from "ms";
import config from "../../config/index.js";
import { AppError } from "../../errors/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import {
  createGoogleAuthorization,
  verifyGoogleCallback,
} from "./google.strategy.js";
import { authService } from "./auth.service.js";

const refreshTokenCookieName = "refreshToken";
const googleOAuthSessionCookieName = "googleOAuthSession";

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "lax",
  path: "/api/v1/auth",
};

const googleSessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env["NODE_ENV"] === "production",
  sameSite: "lax",
  path: "/api/v1/auth/google",
};

const requestContext = (req: Request) => ({
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(refreshTokenCookieName, token, {
    ...refreshCookieOptions,
    maxAge: ms(config.jwt_refresh_expires_in),
  });
};

const register = catchAsync(async (req: Request, res: Response) => {
  const user = await authService.register(req.body, requestContext(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "User registered successfully",
    data: user,
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, requestContext(req));
  setRefreshCookie(res, result.refreshToken);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User logged in successfully",
    data: {
      accessToken: result.accessToken,
      user: result.user,
    },
  });
});

const refresh = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[refreshTokenCookieName];

  if (typeof token !== "string" || !token) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is required");
  }

  const result = await authService.refresh(token, requestContext(req));
  setRefreshCookie(res, result.refreshToken);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Session refreshed successfully",
    data: { accessToken: result.accessToken },
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.[refreshTokenCookieName];

  if (typeof token === "string" && token) {
    await authService.logout(token, requestContext(req));
  }

  res.clearCookie(refreshTokenCookieName, refreshCookieOptions);
  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User logged out successfully",
    data: null,
  });
});

const startGoogleLogin = catchAsync(async (req: Request, res: Response) => {
  const authorization = await createGoogleAuthorization(req.user?.userId);
  res.cookie(googleOAuthSessionCookieName, authorization.session, {
    ...googleSessionCookieOptions,
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(httpStatus.FOUND, authorization.authorizationUrl);
});

const googleCallback = catchAsync(async (req: Request, res: Response) => {
  res.clearCookie(googleOAuthSessionCookieName, googleSessionCookieOptions);

  if (typeof req.query["error"] === "string") {
    throw new AppError(httpStatus.UNAUTHORIZED, "Google login was cancelled");
  }

  const code = req.query["code"];
  const state = req.query["state"];
  const session = req.cookies?.[googleOAuthSessionCookieName];
  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    typeof session !== "string"
  ) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Invalid Google OAuth callback",
    );
  }

  const { identity, linkUserId } = await verifyGoogleCallback(
    code,
    state,
    session,
  );
  const result = await authService.loginWithGoogle(
    identity,
    requestContext(req),
    linkUserId,
  );
  setRefreshCookie(res, result.refreshToken);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User logged in with Google successfully",
    data: { accessToken: result.accessToken, user: result.user },
  });
});

export const authController = {
  register,
  login,
  refresh,
  logout,
  startGoogleLogin,
  googleCallback,
};
