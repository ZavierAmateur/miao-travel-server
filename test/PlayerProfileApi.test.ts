import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { PlayerProfileService } from "../src/domain/profile/PlayerProfileService.js";
import { InMemoryPlayerProfileRepository } from "../src/infrastructure/repositories/InMemoryPlayerProfileRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";

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

const token = "profile-api-session-token";

describe("GET/PUT /v1/profile", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const sessions = new InMemorySessionRepository();
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-profile-1",
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    app = buildApp({
      config,
      now: () => 2_000,
      playerProfileService: new PlayerProfileService({
        sessions,
        profiles: new InMemoryPlayerProfileRepository(),
        now: () => 2_000,
      }),
    });
  });

  afterEach(async () => app.close());

  it("完成空资料读取、主动授权资料保存和再次读取", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      data: { exists: false, nickName: "", avatarUrl: "", updatedAt: 0 },
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { nickName: "  旅行猫  ", avatarUrl: "https://example.com/avatar.png" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      data: { nickName: "旅行猫", avatarUrl: "https://example.com/avatar.png", updatedAt: 2_000 },
    });

    const loaded = await app.inject({
      method: "GET",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(loaded.json()).toMatchObject({
      data: { exists: true, nickName: "旅行猫", avatarUrl: "https://example.com/avatar.png", updatedAt: 2_000 },
    });
  });

  it("没有会话时拒绝读写玩家资料", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/profile" });
    const put = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      payload: { nickName: "旅行猫", avatarUrl: "" },
    });
    expect(get.statusCode).toBe(401);
    expect(put.statusCode).toBe(401);
    expect(get.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("拒绝空昵称、控制字符和非 HTTPS 头像", async () => {
    const invalidPayloads = [
      { nickName: "   ", avatarUrl: "" },
      { nickName: "猫\n咪", avatarUrl: "" },
      { nickName: "旅行猫", avatarUrl: "http://example.com/avatar.png" },
    ];
    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/profile",
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "INVALID_PROFILE" });
    }
  });

  it("丢弃额外字段，避免把微信其他个人信息写入资料表", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { nickName: "旅行猫", avatarUrl: "", gender: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { nickName: "旅行猫", avatarUrl: "" },
    });
    expect(response.body).not.toContain("gender");
  });
});
