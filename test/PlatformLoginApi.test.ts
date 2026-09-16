import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { PlatformLoginService } from "../src/domain/auth/PlatformLoginService.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import type { PlatformAuthGateway } from "../src/platform/PlatformAuthGateway.js";

const config: AppConfig = {
  environment: AppEnvironment.Test,
  host: "127.0.0.1",
  port: 3000,
  platform: PlatformKind.WeChat,
  appId: "wx-app",
  appSecret: "test-secret",
  logLevel: "error",
  persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "",
  cloudbaseRegion: "",
  cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "",
  cloudDatabaseName: "",
};

function createLoginService(): PlatformLoginService {
  const gateway: PlatformAuthGateway = {
    exchangeCode: () => Promise.resolve({
      platform: PlatformKind.WeChat,
      openId: "open-1",
      sessionKey: "platform-session",
    }),
  };
  return new PlatformLoginService({
    config,
    gateway,
    players: new InMemoryPlayerRepository(),
    sessions: new InMemorySessionRepository(),
    now: () => 2_000,
    createPlayerId: () => "player-1",
    createToken: () => "server-token",
  });
}

describe("POST /v1/auth/platform-login", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => app?.close());

  it("返回前端可用的登录结果且不泄露平台身份密钥", async () => {
    app = buildApp({ config, platformLoginService: createLoginService(), now: () => 2_000 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/platform-login",
      headers: { "x-request-id": "login-request-1" },
      payload: { code: "platform-code", clientVersion: "3.4.2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 0,
      msg: "ok",
      timestamp: 2_000,
      requestId: "login-request-1",
      data: {
        token: "server-token",
        playerId: "player-1",
        isNew: true,
        isBanned: false,
        banReason: "",
        banExpire: 0,
        whiteList: false,
        data: "",
        saveRevision: 0,
        serverTime: 2_000,
      },
    });
    expect(response.body).not.toContain("open-1");
    expect(response.body).not.toContain("platform-session");
  });

  it("拒绝缺少平台凭证的请求", async () => {
    app = buildApp({ config, platformLoginService: createLoginService(), now: () => 2_000 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/platform-login",
      payload: { clientVersion: "3.4.2" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
