export class AdminPlayerError extends Error {
  constructor(
    readonly code:
      | "ADMIN_PERMISSION_DENIED"
      | "PLAYER_NOT_FOUND"
      | "INVALID_CURSOR"
      | "INVALID_LEADERBOARD_PAGE"
      | "INVALID_ADMIN_ACTION"
      | "SAVE_NOT_FOUND"
      | "SAVE_PREVIOUS_NOT_FOUND"
      | "SAVE_ROLLBACK_CONFLICT",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AdminPlayerError";
  }
}
