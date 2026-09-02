import type { Role } from "../../../prisma/generated/prisma/client";

export type TLoginPayload = {
    email: string;
    password: string;
};

export type TJwtPayload = {
    userId: number;
    email: string;
    role: Role;
};

export type TAuthTokens = {
    accessToken: string;
    refreshToken: string;
};
