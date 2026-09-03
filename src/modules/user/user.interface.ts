import { Role } from "../../../prisma/generated/prisma/enums"

export interface RegisterUserPayload{
    name: string
    email: string
    role: Role
    password: string
    phone: string
}