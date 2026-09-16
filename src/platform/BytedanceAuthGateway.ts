import { PlatformKind } from "../config/AppConfig.js";
import { fetchJson, type FetchLike } from "./FetchJson.js";
import type { PlatformAuthGateway, PlatformLoginCode, PlatformSession } from "./PlatformAuthGateway.js";
import { PlatformAuthError, PlatformAuthErrorCode } from "./PlatformAuthError.js";

interface BytedanceSessionResponse {
  readonly openid?: string;
  readonly anonymous_openid?: string;
  readonly session_key?: string;
  readonly unionid?: string;
  readonly err_no?: number;
  readonly err_tips?: string;
  readonly message?: string;
}

export class BytedanceAuthGateway implements PlatformAuthGateway {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async exchangeCode(loginCode: PlatformLoginCode): Promise<PlatformSession> {
    const code = loginCode.code?.trim();
    const anonymousCode = loginCode.anonymousCode?.trim();
    if (!code && !anonymousCode) {
      throw new PlatformAuthError(PlatformAuthErrorCode.InvalidCode, "缺少抖音登录 code 或 anonymousCode");
    }

    const url = new URL("https://minigame.zijieapi.com/mgplatform/api/apps/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    if (code) url.searchParams.set("code", code);
    if (anonymousCode) url.searchParams.set("anonymous_code", anonymousCode);
    const data = await fetchJson(this.fetcher, url) as BytedanceSessionResponse;

    if (data.err_no && data.err_no !== 0) {
      throw new PlatformAuthError(
        PlatformAuthErrorCode.Rejected,
        data.err_tips || data.message || "抖音登录凭证校验失败",
        data.err_no,
      );
    }
    const openId = data.openid || data.anonymous_openid;
    if (!openId || !data.session_key) {
      throw new PlatformAuthError(PlatformAuthErrorCode.InvalidResponse, "抖音登录响应缺少必要字段");
    }
    return {
      platform: PlatformKind.ByteDance,
      openId,
      ...(data.unionid ? { unionId: data.unionid } : {}),
      sessionKey: data.session_key,
    };
  }
}
