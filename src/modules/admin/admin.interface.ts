import { z } from "zod";
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

export type AdminUserListQuery = z.infer<
  typeof adminUserListValidationSchema
>["query"];
export type AdminUserStatusPayload = z.infer<
  typeof adminUserStatusValidationSchema
>["body"];
export type AdminHospitalCreatePayload = z.infer<
  typeof adminHospitalCreateValidationSchema
>["body"];
export type AdminHospitalUpdatePayload = z.infer<
  typeof adminHospitalUpdateValidationSchema
>["body"];
export type AdminDonorVerifyPayload = z.infer<
  typeof adminDonorVerifyValidationSchema
>["body"];
export type AdminRematchPayload = z.infer<
  typeof adminRematchValidationSchema
>["body"];
export type AdminDashboardQuery = z.infer<
  typeof adminDashboardValidationSchema
>["query"];
export type AdminDonationReportQuery = z.infer<
  typeof adminDonationReportValidationSchema
>["query"];
export type AdminAuditLogQuery = z.infer<
  typeof adminAuditLogValidationSchema
>["query"];
