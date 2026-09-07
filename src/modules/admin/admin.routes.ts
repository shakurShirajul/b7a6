import { Router } from "express";
import { Role } from "../../generated/prisma/enums.js";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { adminController } from "./admin.controller.js";
import {
  adminAuditLogValidationSchema,
  adminDashboardValidationSchema,
  adminDonationReportValidationSchema,
  adminDonorVerifyValidationSchema,
  adminHospitalCreateValidationSchema,
  adminHospitalUpdateValidationSchema,
  adminRematchValidationSchema,
  adminUserListValidationSchema,
  adminUserStatusValidationSchema,
} from "./admin.validation.js";

const router: Router = Router();

router.get(
  "/admin/users",
  auth(Role.ADMIN),
  validateRequest(adminUserListValidationSchema),
  adminController.listUsers,
);
router.patch(
  "/admin/users/:id/status",
  auth(Role.ADMIN),
  validateRequest(adminUserStatusValidationSchema),
  adminController.updateUserStatus,
);
router.post(
  "/admin/hospitals",
  auth(Role.ADMIN),
  validateRequest(adminHospitalCreateValidationSchema),
  adminController.createHospital,
);
router.patch(
  "/admin/hospitals/:id",
  auth(Role.ADMIN),
  validateRequest(adminHospitalUpdateValidationSchema),
  adminController.updateHospital,
);
router.post(
  "/admin/donors/:id/verify",
  auth(Role.ADMIN),
  validateRequest(adminDonorVerifyValidationSchema),
  adminController.verifyDonor,
);
router.post(
  "/admin/blood-requests/:id/rematch",
  auth(Role.ADMIN),
  validateRequest(adminRematchValidationSchema),
  adminController.rematchBloodRequest,
);
router.get(
  "/admin/dashboard",
  auth(Role.ADMIN),
  validateRequest(adminDashboardValidationSchema),
  adminController.getDashboard,
);
router.get(
  "/admin/reports/donations",
  auth(Role.ADMIN),
  validateRequest(adminDonationReportValidationSchema),
  adminController.getDonationReport,
);
router.get(
  "/admin/audit-logs",
  auth(Role.ADMIN),
  validateRequest(adminAuditLogValidationSchema),
  adminController.listAuditLogs,
);

export const adminRoutes: Router = router;
