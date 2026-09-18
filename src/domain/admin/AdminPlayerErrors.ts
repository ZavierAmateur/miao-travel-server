export class AdminPlayerError extends Error {
  constructor(
    readonly code: "ADMIN_PERMISSION_DENIED" | "PLAYER_NOT_FOUND" | "INVALID_CURSOR",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AdminPlayerError";
  }
}
