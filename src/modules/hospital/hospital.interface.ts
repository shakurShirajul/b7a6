import { z } from "zod";
import { hospitalListValidationSchema } from "./hospital.validation.js";

export type HospitalListQuery = z.infer<
  typeof hospitalListValidationSchema
>["query"];
