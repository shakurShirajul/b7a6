import { BloodType, RequestStatus } from "../../../prisma/generated/prisma/enums"


export interface BloodRequest {
    id?: number
    patientId: number
    bloodType: BloodType
    quantity: number
    status: RequestStatus
    isUrgent: boolean
    requestedAt: Date
    requiredAt: Date
    fulfilledAt?: Date
    description: string
    division: string
    district: string
    area: string
    hospitalName: string
}

export interface DonorRequest{
    donorId?: number
    bloodRequestId: number
    status: RequestStatus
}