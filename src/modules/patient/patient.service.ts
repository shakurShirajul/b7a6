import httpStatus from "http-status";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import type { UpdatePatientProfilePayload } from "./patient.interface.js";

const patientProfileSelect = {
  id: true,
  bloodType: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  totalReceivedCount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientProfileSelect;

const getMyProfile = async (userId: number) => {
  const profile = await prisma.patientProfile.findUnique({
    where: { userId },
    select: patientProfileSelect,
  });

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient profile not found");
  }

  return profile;
};

const updateMyProfile = async (
  userId: number,
  payload: UpdatePatientProfilePayload,
  context: TRequestContext,
) =>
  prisma.$transaction(async (transaction) => {
    const existingProfile = await transaction.patientProfile.findUnique({
      where: { userId },
      select: patientProfileSelect,
    });

    if (!existingProfile) {
      throw new AppError(httpStatus.NOT_FOUND, "Patient profile not found");
    }

    const profile = await transaction.patientProfile.update({
      where: { userId },
      data: payload,
      select: patientProfileSelect,
    });

    await recordAuditEvent(
      {
        actorId: userId,
        action: "PATIENT_PROFILE_UPDATED",
        entityType: "PatientProfile",
        entityId: String(existingProfile.id),
        before: existingProfile,
        after: profile,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return profile;
  });

export const patientService = {
  getMyProfile,
  updateMyProfile,
};
