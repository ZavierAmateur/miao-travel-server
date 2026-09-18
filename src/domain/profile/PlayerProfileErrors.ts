export class PlayerProfileValidationError extends Error {
  readonly code = "INVALID_PROFILE" as const;

  constructor(message: string) {
    super(message);
    this.name = "PlayerProfileValidationError";
  }
}
