import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/, "Phone number contains invalid characters");
