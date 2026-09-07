import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { hospitalController } from "./hospital.controller.js";
import {
  hospitalDetailsValidationSchema,
  hospitalListValidationSchema,
} from "./hospital.validation.js";

const router: Router = Router();
const authenticatedRoles = [Role.PATIENT, Role.DONOR, Role.ADMIN] as const;

router.get(
  "/hospitals",
  auth(...authenticatedRoles),
  validateRequest(hospitalListValidationSchema),
  hospitalController.listHospitals,
);
router.get(
  "/hospitals/:id",
  auth(...authenticatedRoles),
  validateRequest(hospitalDetailsValidationSchema),
  hospitalController.getHospitalById,
);

export const hospitalRoutes: Router = router;
