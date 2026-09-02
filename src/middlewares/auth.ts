import { NextFunction, Request, Response } from "express";
import { Role } from "../../prisma/generated/prisma/enums";
import { AppError } from "../errors/AppError";
import httpStatus from "http-status";
import config from "../config";
import jwt from "jsonwebtoken";
import { TJwtPayload } from "../modules/auth/auth.interface";

export const auth = (...requiredRoles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new AppError(
          httpStatus.UNAUTHORIZED,
          "Authorization token is required",
        );
      }
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(
        token,
        config.jwt_access_secret,
      ) as TJwtPayload;
      if (requiredRoles.length && !requiredRoles.includes(decoded.role)) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You do not have permission to access this resource",
        );
      }
      req.user = decoded;
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
};
