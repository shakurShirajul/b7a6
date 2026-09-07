import { Router } from "express";
import { optionalAuth } from "../../middlewares/auth.js";
import {
  googleAuthRateLimit,
  loginRateLimit,
  refreshRateLimit,
  registrationRateLimit,
} from "../../middlewares/rateLimit.js";
import {
  emptyRequestValidationSchema,
  validateRequest,
} from "../../middlewares/validateRequest.js";
import { authController } from "./auth.controller.js";
import {
  googleCallbackValidationSchema,
  loginValidationSchema,
  registerValidationSchema,
} from "./auth.validation.js";

const router: Router = Router();

router.post(
  "/auth/register",
  registrationRateLimit,
  validateRequest(registerValidationSchema),
  authController.register,
);
router.post(
  "/auth/login",
  loginRateLimit,
  validateRequest(loginValidationSchema),
  authController.login,
);
router.post(
  "/auth/refresh-token",
  refreshRateLimit,
  validateRequest(emptyRequestValidationSchema),
  authController.refresh,
);
router.post(
  "/auth/logout",
  refreshRateLimit,
  validateRequest(emptyRequestValidationSchema),
  authController.logout,
);
router.get(
  "/auth/google",
  googleAuthRateLimit,
  optionalAuth,
  validateRequest(emptyRequestValidationSchema),
  authController.startGoogleLogin,
);
router.get(
  "/auth/google/callback",
  googleAuthRateLimit,
  validateRequest(googleCallbackValidationSchema),
  authController.googleCallback,
);

export const authRoutes: Router = router;
