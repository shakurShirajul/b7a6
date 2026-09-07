import type { BloodType, Gender, Role } from "../../generated/prisma/client.js";

export type TLoginPayload = {
  email: string;
  password: string;
};

export type TJwtPayload = {
  userId: number;
  email: string;
  role: Role;
  tokenType: "access" | "refresh";
  jti?: string;
};

export type TRequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

type TRegisterBase = {
  name: string;
  email: string;
  password: string;
  phone: string;
  avatar?: string;
  dateOfBirth?: Date;
  gender?: Gender;
  bloodType: BloodType;
};

export type TPatientRegistration = TRegisterBase & {
  role: "PATIENT";
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

export type TDonorRegistration = TRegisterBase & {
  role: "DONOR";
  weightKg: number;
  division: string;
  district: string;
  area: string;
  latitude?: number;
  longitude?: number;
};

export type TRegisterPayload = TPatientRegistration | TDonorRegistration;
