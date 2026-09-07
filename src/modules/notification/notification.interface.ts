import { z } from "zod";
import { notificationListValidationSchema } from "./notification.validation.js";

export type NotificationListQuery = z.infer<
  typeof notificationListValidationSchema
>["query"];
