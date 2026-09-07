import { BloodType } from "../../generated/prisma/enums.js";

export interface PatientProfile {
  id?: number;
  userId: number;
  totalReceivedCount: number;
  bloodType: BloodType;
}

export interface DonorProfile {
  id?: number;
  userId: number;
  division: string;
  district: string;
  area: string;
  bloodType: BloodType;
  weightKg: number;
  totalDonationCount: number;
  isAvailable: boolean;
  lastDonationDate?: Date;
}
