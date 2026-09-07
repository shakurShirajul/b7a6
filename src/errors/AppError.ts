export type ErrorDetail = {
  path: string;
  message: string;
};

export class AppError extends Error {
  statusCode: number;
  errors: ErrorDetail[];

  constructor(statusCode: number, message: string, errors: ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
