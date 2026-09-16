import type { PlatformKind } from "../config/AppConfig.js";

export interface PlatformLoginCode {
  readonly code?: string;
  readonly anonymousCode?: string;
}

export interface PlatformSession {
  readonly platform: PlatformKind;
  readonly openId: string;
  readonly unionId?: string;
  readonly sessionKey: string;
}

export interface PlatformAuthGateway {
  exchangeCode(loginCode: PlatformLoginCode): Promise<PlatformSession>;
}
