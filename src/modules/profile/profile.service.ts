import { prisma } from "../../lib/prisma.js";
import { DonorProfile, PatientProfile } from "./profile.interface.js";

const insertDonorProfile = async (payload: DonorProfile) => {
  const donorProfile = await prisma.donorProfile.create({ data: payload });
  return donorProfile;
};
const insertPatientProfile = (payload: PatientProfile) => {
  const patientProfile = prisma.patientProfile.create({ data: payload });
  return patientProfile;
};
const patchPatientProfile = (payload: PatientProfile) => {
  const patientProfile = prisma.patientProfile.update({
    where: { id: payload.id },
    data: payload,
  });
  return patientProfile;
};
const patchDonorProfile = (payload: DonorProfile) => {
  const donorProfile = prisma.donorProfile.update({
    where: { id: payload.id },
    data: payload,
  });
  return donorProfile;
};

export const profileService = {
  insertPatientProfile,
  insertDonorProfile,
  patchPatientProfile,
  patchDonorProfile,
};
