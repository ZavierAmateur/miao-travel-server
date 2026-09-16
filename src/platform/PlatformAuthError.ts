export const PlatformAuthErrorCode = Object.freeze({
  InvalidCode: "PLATFORM_CODE_INVALID",
  Rejected: "PLATFORM_AUTH_REJECTED",
  Unavailable: "PLATFORM_AUTH_UNAVAILABLE",
  InvalidResponse: "PLATFORM_RESPONSE_INVALID",
} as const);

export type PlatformAuthErrorCode = typeof PlatformAuthErrorCode[keyof typeof PlatformAuthErrorCode];

export class PlatformAuthError extends Error {
  constructor(
    readonly code: PlatformAuthErrorCode,
    message: string,
    readonly platformErrorCode?: number,
  ) {
    super(message);
    this.name = "PlatformAuthError";
  }
}
