import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const getBloodsRequestFromDB = async () => {
  const bloodRequests = await prisma.bloodRequest.findMany();
  return bloodRequests;
};

const getBloodRequestByIdFromDB = async (id: number) => {
  const bloodRequest = await prisma.bloodRequest.findUnique({
    where: {
      id,
    },
  });
  return bloodRequest;
};

const getDonorsRequestFromDB = async () => {
  const donorRequests = await prisma.donorAssignment.findMany();
  return donorRequests;
};

const getDonorRequestByIdFromDB = async (id: number) => {
  const donorRequest = await prisma.donorAssignment.findUnique({
    where: {
      id,
    },
  });
  return donorRequest;
};

const createBloodRequestInDB = async (
  bloodRequestData: Prisma.BloodRequestUncheckedCreateInput,
) => {
  const newBloodRequest = await prisma.bloodRequest.create({
    data: bloodRequestData,
  });
  return newBloodRequest;
};

const approvdeBloodRequest = async (id: number) => {
  const updateBloodRequwest = await prisma.bloodRequest.update({
    where: { id },
    data: { status: "VERIFIED" },
  });

  // Send Blood Request To Donor (Blood Group Check, Location Check, Availability Check)
  // Send Email to Donor
  // Send Notifcation to Donor

  return updateBloodRequwest;
};

export const requestService = {
  getBloodsRequestFromDB,
  getBloodRequestByIdFromDB,
  getDonorsRequestFromDB,
  getDonorRequestByIdFromDB,
  createBloodRequestInDB,
  approvdeBloodRequest,
};
