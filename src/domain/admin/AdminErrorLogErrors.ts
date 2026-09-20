export class AdminErrorLogError extends Error {
  constructor(
    readonly code: "ADMIN_PERMISSION_DENIED" | "ERROR_LOG_NOT_FOUND" | "INVALID_CURSOR" | "INVALID_ERROR_QUERY",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AdminErrorLogError";
  }
}
