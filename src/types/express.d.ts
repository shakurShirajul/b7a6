import type { Role } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; email: string; role: Role };
      requestId?: string;
    }
  }
}

export {};
