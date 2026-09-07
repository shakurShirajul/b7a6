import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import { Prisma } from "../generated/prisma/client.js";
import { ZodError } from "zod";
import { AppError, type ErrorDetail } from "../errors/AppError.js";

type ErrorResponse = {
  statusCode: number;
  message: string;
  errors: ErrorDetail[];
};

const zodErrorDetails = (error: ZodError): ErrorDetail[] =>
  error.issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));

const prismaErrorDetails = (
  error: Prisma.PrismaClientKnownRequestError,
): ErrorDetail[] => {
  const target = error.meta?.target;
  const path = Array.isArray(target)
    ? target.join(", ")
    : String(target ?? error.meta?.modelName ?? "database");

  const messageByCode: Record<string, string> = {
    P2002: "This value must be unique",
    P2025: "The requested resource does not exist",
    P2034: "The resource changed concurrently; retry the operation",
  };

  return [
    {
      path,
      message:
        messageByCode[error.code] ??
        "The database request could not be completed",
    },
  ];
};

const normalizeError = (error: unknown): ErrorResponse => {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      errors: error.errors,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: httpStatus.BAD_REQUEST,
      message: "Validation failed",
      errors: zodErrorDetails(error),
    };
  }

  if (error instanceof Error && "type" in error) {
    if (error.type === "entity.parse.failed") {
      return {
        statusCode: httpStatus.BAD_REQUEST,
        message: "Malformed JSON request body",
        errors: [{ path: "body", message: "Body must contain valid JSON" }],
      };
    }
    if (error.type === "entity.too.large") {
      return {
        statusCode: httpStatus.REQUEST_ENTITY_TOO_LARGE,
        message: "Request body is too large",
        errors: [
          { path: "body", message: "Request body exceeds the 1 MB limit" },
        ],
      };
    }
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return {
        statusCode: httpStatus.CONFLICT,
        message: "The resource changed concurrently. Please retry.",
        errors: prismaErrorDetails(error),
      };
    }
    if (error.code === "P2002") {
      return {
        statusCode: httpStatus.CONFLICT,
        message: "A record with this value already exists",
        errors: prismaErrorDetails(error),
      };
    }

    if (error.code === "P2025") {
      return {
        statusCode: httpStatus.NOT_FOUND,
        message: "Resource not found",
        errors: prismaErrorDetails(error),
      };
    }

    return {
      statusCode: httpStatus.BAD_REQUEST,
      message: "Database request failed",
      errors: prismaErrorDetails(error),
    };
  }

  if (error instanceof jwt.TokenExpiredError) {
    return {
      statusCode: httpStatus.UNAUTHORIZED,
      message: "Token expired",
      errors: [],
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return {
      statusCode: httpStatus.UNAUTHORIZED,
      message: "Invalid token",
      errors: [],
    };
  }

  return {
    statusCode: httpStatus.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    errors: [],
  };
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalizedError = normalizeError(error);
  const response = {
    success: false,
    ...normalizedError,
    ...(process.env.NODE_ENV !== "production" && error instanceof Error
      ? { stack: error.stack }
      : {}),
  };

  res.status(normalizedError.statusCode).json(response);
};
