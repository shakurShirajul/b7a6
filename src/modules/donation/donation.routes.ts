import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { donationController } from "./donation.controller.js";
import { completeDonationValidationSchema } from "./donation.validation.js";

const router: Router = Router();

router.post(
  "/admin/assignments/:id/complete",
  auth(Role.ADMIN),
  validateRequest(completeDonationValidationSchema),
  donationController.completeDonation,
);

export const donationRoutes: Router = router;
