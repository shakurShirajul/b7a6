import type { Request, Response } from "express";

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: "Endpoint not found. Check the request URL and HTTP method.",
    errors: [],
  });
};
