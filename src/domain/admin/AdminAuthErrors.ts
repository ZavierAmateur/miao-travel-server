export class AdminAuthError extends Error {
  constructor(
    readonly code: "ADMIN_AUTH_REQUIRED" | "ADMIN_CREDENTIALS_INVALID" | "ADMIN_SESSION_INVALID"
      | "ADMIN_SESSION_EXPIRED" | "ADMIN_ACCOUNT_DISABLED" | "ADMIN_LOGIN_RATE_LIMITED",
    message: string,
    readonly statusCode: 401 | 403 | 429,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}
