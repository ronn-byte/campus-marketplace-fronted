export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type HttpError = Error & { statusCode: number };

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function errorPayload(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
