import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { bloodRequestCreationRateLimit } from "../../middlewares/rateLimit.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { bloodRequestController } from "./blood-request.controller.js";
import {
  bloodRequestIdValidationSchema,
  bloodRequestListValidationSchema,
  createBloodRequestValidationSchema,
  updateBloodRequestValidationSchema,
  verifyBloodRequestValidationSchema,
} from "./blood-request.validation.js";

const router: Router = Router();
const authenticatedRoles = [Role.PATIENT, Role.DONOR, Role.ADMIN] as const;

router.post(
  "/blood-requests",
  auth(Role.PATIENT),
  bloodRequestCreationRateLimit,
  validateRequest(createBloodRequestValidationSchema),
  bloodRequestController.createBloodRequest,
);
router.get(
  "/blood-requests",
  auth(...authenticatedRoles),
  validateRequest(bloodRequestListValidationSchema),
  bloodRequestController.listBloodRequests,
);
router.get(
  "/blood-requests/mine",
  auth(Role.PATIENT),
  validateRequest(bloodRequestListValidationSchema),
  bloodRequestController.listMyBloodRequests,
);
router.get(
  "/blood-requests/:id",
  auth(...authenticatedRoles),
  validateRequest(bloodRequestIdValidationSchema),
  bloodRequestController.getBloodRequest,
);
router.patch(
  "/blood-requests/:id",
  auth(Role.PATIENT),
  validateRequest(updateBloodRequestValidationSchema),
  bloodRequestController.updateBloodRequest,
);
router.delete(
  "/blood-requests/:id",
  auth(Role.PATIENT, Role.ADMIN),
  validateRequest(bloodRequestIdValidationSchema),
  bloodRequestController.deleteBloodRequest,
);
router.post(
  "/blood-requests/:id/cancel",
  auth(Role.PATIENT, Role.ADMIN),
  validateRequest(bloodRequestIdValidationSchema),
  bloodRequestController.cancelBloodRequest,
);
router.post(
  "/admin/blood-requests/:id/verify",
  auth(Role.ADMIN),
  validateRequest(verifyBloodRequestValidationSchema),
  bloodRequestController.verifyBloodRequest,
);

export const bloodRequestRoutes: Router = router;
