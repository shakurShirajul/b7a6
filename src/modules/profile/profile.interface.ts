import { BloodType } from "../../../prisma/generated/prisma/enums";

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
  totalDontationCount: number;
  isAvailable: boolean;
  lastDonationDate: Date;
}
