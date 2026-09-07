import type { Request } from "express";
import httpStatus from "http-status";
import { AppError } from "../errors/AppError.js";

export const requireCurrentUser = (req: Request) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Authentication is required");
  }
  return req.user;
};
