export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function publicError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "Something interrupted this request. Please try again later.",
      );
}
