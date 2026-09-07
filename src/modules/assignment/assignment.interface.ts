import type { z } from "zod";
import type {
  assignmentListValidationSchema,
  rejectAssignmentValidationSchema,
} from "./assignment.validation.js";

export type AssignmentListQuery = z.infer<
  typeof assignmentListValidationSchema
>["query"];

export type RejectAssignmentPayload = z.infer<
  typeof rejectAssignmentValidationSchema
>["body"];
