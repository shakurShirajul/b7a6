type Role = "PATIENT" | "HOSPITAL" | "DONOR" | "ADMIN" | "VOLUNTEER";
export interface RegisterUserPayload{
    name: string
    email: string
    role: Role
    password: string
    phone: string
}