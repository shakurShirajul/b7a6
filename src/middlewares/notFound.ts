import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

export const notFound = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`));
};
