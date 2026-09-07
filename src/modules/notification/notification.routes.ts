import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { notificationController } from "./notification.controller.js";
import {
  notificationIdValidationSchema,
  notificationListValidationSchema,
  notificationReadAllValidationSchema,
} from "./notification.validation.js";

const router: Router = Router();
const authenticatedRoles = [Role.PATIENT, Role.DONOR, Role.ADMIN] as const;

router.get(
  "/notifications",
  auth(...authenticatedRoles),
  validateRequest(notificationListValidationSchema),
  notificationController.listOwnNotifications,
);
router.patch(
  "/notifications/read-all",
  auth(...authenticatedRoles),
  validateRequest(notificationReadAllValidationSchema),
  notificationController.markAllOwnRead,
);
router.patch(
  "/notifications/:id/read",
  auth(...authenticatedRoles),
  validateRequest(notificationIdValidationSchema),
  notificationController.markOwnRead,
);

export const notificationRoutes: Router = router;
