import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError, type ErrorDetail } from "../errors/AppError.js";

export type RequestEnvelope = {
  body?: unknown;
  params?: unknown;
  query?: unknown;
};

export const requestEnvelopeSchema = z.object({
  body: z.unknown().optional(),
  params: z.unknown().optional(),
  query: z.unknown().optional(),
});

const emptyObjectSchema = z.object({}).strict().default({});

export const emptyRequestValidationSchema = z
  .object({
    body: emptyObjectSchema,
    params: emptyObjectSchema,
    query: emptyObjectSchema,
  })
  .strict();

export type RequestValidationSchema = z.ZodType<RequestEnvelope>;

const formatZodIssues = (issues: z.core.$ZodIssue[]): ErrorDetail[] =>
  issues.map((issue) => ({
    path: issue.path.join(".") || "request",
    message: issue.message,
  }));

export const validateRequest = (schema: RequestValidationSchema) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsedRequest = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!parsedRequest.success) {
      next(
        new AppError(
          400,
          "Validation failed",
          formatZodIssues(parsedRequest.error.issues),
        ),
      );
      return;
    }

    if (parsedRequest.data.body !== undefined) {
      req.body = parsedRequest.data.body;
    }

    if (parsedRequest.data.params !== undefined) {
      req.params = parsedRequest.data.params as Request["params"];
    }

    if (parsedRequest.data.query !== undefined) {
      Object.defineProperty(req, "query", {
        configurable: true,
        enumerable: true,
        value: parsedRequest.data.query as Request["query"],
        writable: true,
      });
    }

    next();
  };
};
