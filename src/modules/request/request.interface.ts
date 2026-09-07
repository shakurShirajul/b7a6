import {
  AssignmentStatus,
  BloodRequestStatus,
  BloodType,
  Urgency,
} from "../../generated/prisma/enums.js";

export interface BloodRequest {
  id?: number;
  patientId: number;
  hospitalId: number;
  bloodType: BloodType;
  unitsRequired: number;
  unitsFulfilled: number;
  status: BloodRequestStatus;
  urgency: Urgency;
  requiredAt: Date;
  fulfilledAt?: Date;
  description: string;
  division: string;
  district: string;
  area: string;
}

export interface DonorAssignment {
  donorId?: number;
  bloodRequestId: number;
  status: AssignmentStatus;
}
