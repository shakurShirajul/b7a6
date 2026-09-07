import type { Gender } from "../../generated/prisma/enums.js";

export type UpdateMyProfilePayload = {
  name?: string;
  phone?: string;
  avatar?: string | null;
  dateOfBirth?: Date | null;
  gender?: Gender | null;
};
