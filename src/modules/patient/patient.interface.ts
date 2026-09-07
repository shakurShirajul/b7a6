import { z } from "zod";
import { updatePatientProfileValidationSchema } from "./patient.validation.js";

export type UpdatePatientProfilePayload = z.infer<
  typeof updatePatientProfileValidationSchema
>["body"];
