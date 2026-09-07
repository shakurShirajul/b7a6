import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import {
  emptyRequestValidationSchema,
  validateRequest,
} from "../../middlewares/validateRequest.js";
import { donorController } from "./donor.controller.js";
import {
  donationHistoryValidationSchema,
  updateDonorAvailabilityValidationSchema,
  updateDonorProfileValidationSchema,
} from "./donor.validation.js";

const router: Router = Router();

router.get(
  "/donors/me",
  auth(Role.DONOR),
  validateRequest(emptyRequestValidationSchema),
  donorController.getMyProfile,
);
router.patch(
  "/donors/me",
  auth(Role.DONOR),
  validateRequest(updateDonorProfileValidationSchema),
  donorController.updateMyProfile,
);
router.patch(
  "/donors/me/availability",
  auth(Role.DONOR),
  validateRequest(updateDonorAvailabilityValidationSchema),
  donorController.updateMyAvailability,
);
router.get(
  "/donors/me/donations",
  auth(Role.DONOR),
  validateRequest(donationHistoryValidationSchema),
  donorController.getMyDonations,
);

export const donorRoutes: Router = router;
