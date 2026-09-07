import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import httpStatus from "http-status";
import { AppError } from "../errors/AppError.js";

const createRateLimiter = (
  limit: number,
  message = "Too many authentication attempts. Please try again later.",
  perUser = false,
  windowMs = 15 * 60 * 1000,
) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(perUser
      ? {
          keyGenerator: (req: import("express").Request) =>
            req.user
              ? `user:${req.user.userId}`
              : ipKeyGenerator(req.ip ?? "unknown"),
        }
      : {}),
    handler: (_req, _res, next) => {
      next(new AppError(httpStatus.TOO_MANY_REQUESTS, message));
    },
  });

export const registrationRateLimit = createRateLimiter(5);
export const loginRateLimit = createRateLimiter(10);
export const refreshRateLimit = createRateLimiter(30);
export const googleAuthRateLimit = createRateLimiter(20);
export const bloodRequestCreationRateLimit = createRateLimiter(
  10,
  "Too many blood request creation attempts. Please try again later.",
  true,
);
export const checkoutCreationRateLimit = createRateLimiter(
  10,
  "Too many payment Checkout creation attempts. Please try again later.",
  true,
);
