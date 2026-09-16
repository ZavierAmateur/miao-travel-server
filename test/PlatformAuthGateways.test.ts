import { describe, expect, it, vi } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import type { FetchLike } from "../src/platform/FetchJson.js";
import { BytedanceAuthGateway } from "../src/platform/BytedanceAuthGateway.js";
import { PlatformAuthError } from "../src/platform/PlatformAuthError.js";
import { WechatAuthGateway } from "../src/platform/WechatAuthGateway.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("platform auth gateways", () => {
  it("使用微信 code2Session 并归一化身份", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      openid: "wx-open",
      session_key: "wx-session",
      unionid: "wx-union",
    }));
    const gateway = new WechatAuthGateway("wx-app", "wx-secret", fetcher);

    await expect(gateway.exchangeCode({ code: "wx-code" })).resolves.toEqual({
      platform: PlatformKind.WeChat,
      openId: "wx-open",
      sessionKey: "wx-session",
      unionId: "wx-union",
    });
    const calledUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("appid")).toBe("wx-app");
    expect(calledUrl.searchParams.get("js_code")).toBe("wx-code");
  });

  it("支持抖音匿名 code 并归一化匿名 openId", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      anonymous_openid: "tt-anonymous-open",
      session_key: "tt-session",
      err_no: 0,
    }));
    const gateway = new BytedanceAuthGateway("tt-app", "tt-secret", fetcher);

    await expect(gateway.exchangeCode({ anonymousCode: "anonymous-code" })).resolves.toEqual({
      platform: PlatformKind.ByteDance,
      openId: "tt-anonymous-open",
      sessionKey: "tt-session",
    });
    const calledUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("anonymous_code")).toBe("anonymous-code");
    expect(calledUrl.searchParams.has("code")).toBe(false);
  });

  it("不会把平台拒绝响应当作成功", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({
      errcode: 40029,
      errmsg: "invalid code",
    }));
    const gateway = new WechatAuthGateway("wx-app", "wx-secret", fetcher);
    await expect(gateway.exchangeCode({ code: "bad-code" })).rejects.toBeInstanceOf(PlatformAuthError);
  });
});
