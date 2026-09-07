import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import {
  emptyRequestValidationSchema,
  validateRequest,
} from "../../middlewares/validateRequest.js";
import { patientController } from "./patient.controller.js";
import { updatePatientProfileValidationSchema } from "./patient.validation.js";

const router: Router = Router();

router.get(
  "/patients/me",
  auth(Role.PATIENT),
  validateRequest(emptyRequestValidationSchema),
  patientController.getMyProfile,
);
router.patch(
  "/patients/me",
  auth(Role.PATIENT),
  validateRequest(updatePatientProfileValidationSchema),
  patientController.updateMyProfile,
);

export const patientRoutes: Router = router;
