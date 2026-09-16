import { PlatformKind } from "../config/AppConfig.js";
import { fetchJson, type FetchLike } from "./FetchJson.js";
import type { PlatformAuthGateway, PlatformLoginCode, PlatformSession } from "./PlatformAuthGateway.js";
import { PlatformAuthError, PlatformAuthErrorCode } from "./PlatformAuthError.js";

interface WechatSessionResponse {
  readonly openid?: string;
  readonly session_key?: string;
  readonly unionid?: string;
  readonly errcode?: number;
  readonly errmsg?: string;
}

export class WechatAuthGateway implements PlatformAuthGateway {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async exchangeCode(loginCode: PlatformLoginCode): Promise<PlatformSession> {
    const code = loginCode.code?.trim();
    if (!code) throw new PlatformAuthError(PlatformAuthErrorCode.InvalidCode, "缺少微信登录 code");

    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const data = await fetchJson(this.fetcher, url) as WechatSessionResponse;

    if (data.errcode && data.errcode !== 0) {
      throw new PlatformAuthError(
        PlatformAuthErrorCode.Rejected,
        data.errmsg || "微信登录凭证校验失败",
        data.errcode,
      );
    }
    if (!data.openid || !data.session_key) {
      throw new PlatformAuthError(PlatformAuthErrorCode.InvalidResponse, "微信登录响应缺少必要字段");
    }
    return {
      platform: PlatformKind.WeChat,
      openId: data.openid,
      ...(data.unionid ? { unionId: data.unionid } : {}),
      sessionKey: data.session_key,
    };
  }
}
