import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import config from "../config/index.js";
import { AppError } from "../errors/AppError.js";
import { Role, UserStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import type { TJwtPayload } from "../modules/auth/auth.interface.js";

type CurrentUser = NonNullable<Request["user"]>;

const verifyAccessToken = (token: string) => {
  const decoded = jwt.verify(token, config.jwt_access_secret, {
    algorithms: ["HS256"],
  });

  if (
    typeof decoded === "string" ||
    decoded["tokenType"] !== "access" ||
    typeof decoded["userId"] !== "number"
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid token");
  }

  return decoded as TJwtPayload & jwt.JwtPayload;
};

export const auth =
  (...requiredRoles: Role[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new AppError(
          httpStatus.UNAUTHORIZED,
          "Authorization token is required",
        );
      }

      const token = authHeader.slice("Bearer ".length).trim();
      if (!token) {
        throw new AppError(
          httpStatus.UNAUTHORIZED,
          "Authorization token is required",
        );
      }

      const decoded = verifyAccessToken(token);
      const currentUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          deletedAt: true,
        },
      });

      if (
        !currentUser ||
        currentUser.status !== UserStatus.ACTIVE ||
        currentUser.deletedAt
      ) {
        throw new AppError(httpStatus.UNAUTHORIZED, "User account is inactive");
      }

      if (requiredRoles.length && !requiredRoles.includes(currentUser.role)) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You do not have permission to access this resource",
        );
      }

      req.user = {
        userId: currentUser.id,
        email: currentUser.email,
        role: currentUser.role,
      };
      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        next(new AppError(httpStatus.UNAUTHORIZED, "Token expired"));
        return;
      }

      if (error instanceof jwt.JsonWebTokenError) {
        next(new AppError(httpStatus.UNAUTHORIZED, "Invalid token"));
        return;
      }

      next(error);
    }
  };

export const requireOwnerOrAdmin = (
  currentUser: CurrentUser,
  ownerUserId: number,
) => {
  if (currentUser.role !== Role.ADMIN && currentUser.userId !== ownerUserId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You do not have permission to access this resource",
    );
  }
};

// A supplied credential must be valid; only an absent header is public.
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.headers.authorization === undefined) {
    next();
    return;
  }
  return auth()(req, res, next);
};
