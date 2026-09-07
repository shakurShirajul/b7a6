import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { assignmentController } from "./assignment.controller.js";
import {
  acceptAssignmentValidationSchema,
  assignmentListValidationSchema,
  rejectAssignmentValidationSchema,
} from "./assignment.validation.js";

const router: Router = Router();

router.get(
  "/donor-assignments/mine",
  auth(Role.DONOR),
  validateRequest(assignmentListValidationSchema),
  assignmentController.listMyAssignments,
);
router.post(
  "/donor-assignments/:id/accept",
  auth(Role.DONOR),
  validateRequest(acceptAssignmentValidationSchema),
  assignmentController.acceptAssignment,
);
router.post(
  "/donor-assignments/:id/reject",
  auth(Role.DONOR),
  validateRequest(rejectAssignmentValidationSchema),
  assignmentController.rejectAssignment,
);

export const assignmentRoutes: Router = router;
