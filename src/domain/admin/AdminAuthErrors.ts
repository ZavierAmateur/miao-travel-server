export class AdminAuthError extends Error {
  constructor(
    readonly code: "ADMIN_AUTH_REQUIRED" | "ADMIN_CREDENTIALS_INVALID" | "ADMIN_SESSION_INVALID"
      | "ADMIN_SESSION_EXPIRED" | "ADMIN_ACCOUNT_DISABLED",
    message: string,
    readonly statusCode: 401 | 403,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}
