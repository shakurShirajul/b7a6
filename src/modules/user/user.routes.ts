import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import {
  emptyRequestValidationSchema,
  validateRequest,
} from "../../middlewares/validateRequest.js";
import { userController } from "./user.controller.js";
import { updateMyProfileValidationSchema } from "./user.validation.js";

const router: Router = Router();
const authenticatedRoles = [Role.PATIENT, Role.DONOR, Role.ADMIN] as const;

router.get(
  "/users/me",
  auth(...authenticatedRoles),
  validateRequest(emptyRequestValidationSchema),
  userController.getMyProfile,
);
router.patch(
  "/users/me",
  auth(...authenticatedRoles),
  validateRequest(updateMyProfileValidationSchema),
  userController.updateMyProfile,
);

export const userRoutes: Router = router;
