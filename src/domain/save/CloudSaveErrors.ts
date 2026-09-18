export class SessionAuthenticationError extends Error {
  constructor(
    readonly code: "AUTH_REQUIRED" | "SESSION_INVALID" | "SESSION_EXPIRED" | "PLAYER_BANNED",
    message: string,
  ) {
    super(message);
    this.name = "SessionAuthenticationError";
  }
}

export class CloudSaveValidationError extends Error {
  constructor(
    readonly code: "INVALID_SAVE" | "SAVE_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "CloudSaveValidationError";
  }
}

export class CloudSaveConflictError extends Error {
  constructor(readonly current?: { revision: number; serverSavedAt: number; hash: string }) {
    super("云存档版本冲突，请先拉取最新存档");
    this.name = "CloudSaveConflictError";
  }
}
