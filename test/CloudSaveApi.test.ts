import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { CloudSaveService } from "../src/domain/save/CloudSaveService.js";
import type { CloudSaveRepository } from "../src/domain/save/CloudSaveRepository.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";

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

const token = "api-session-token";
const payload = {
  baseRevision: 0,
  clientVersion: "3.4.2",
  clientSavedAt: 1_900,
  idempotencyKey: "api-request-key-0001",
  save: {
    version: "3.4.2",
    serialized: 1,
    time: 1_900,
    modules: { user: { level: 5 }, settings: { music: 1 } },
  },
};

describe("GET/PUT /v1/save", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const sessions = new InMemorySessionRepository();
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-1",
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    app = buildApp({
      config,
      now: () => 2_000,
      cloudSaveService: new CloudSaveService({
        sessions,
        saves: new InMemoryCloudSaveRepository(),
        now: () => 2_000,
      }),
    });
  });

  afterEach(async () => app.close());

  it("完成空存档读取、首次保存和再次读取", async () => {
    const empty = await app.inject({ method: "GET", url: "/v1/save", headers: { authorization: `Bearer ${token}` } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<{ data: unknown }>().data).toEqual({ exists: false, revision: 0, serverSavedAt: 0, save: null });

    const saved = await app.inject({
      method: "PUT",
      url: "/v1/save",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ data: object }>().data).toMatchObject({ revision: 1, duplicate: false });

    const loaded = await app.inject({ method: "GET", url: "/v1/save", headers: { authorization: `Bearer ${token}` } });
    expect(loaded.json<{ data: object }>().data).toMatchObject({
      exists: true,
      revision: 1,
      save: { ...payload.save, modules: { user: { level: 5 } } },
    });
  });

  it("没有 Bearer token 时返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/save" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("已有玩家会话在封禁后立即停止云存档访问", async () => {
    const sessions = new InMemorySessionRepository();
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-1", createdAt: 1_000, expiresAt: 10_000,
    });
    const players = new InMemoryPlayerRepository();
    await players.save({
      id: "player-1", platform: PlatformKind.WeChat, appId: "wx-app", platformOpenId: "openid",
      status: "banned", banReason: "异常行为", banExpiresAt: 9_000, createdAt: 1_000, lastLoginAt: 1_000,
    });
    const bannedApp = buildApp({
      config, now: () => 2_000,
      cloudSaveService: new CloudSaveService({ sessions, players, saves: new InMemoryCloudSaveRepository(), now: () => 2_000 }),
    });
    try {
      const response = await bannedApp.inject({ method: "GET", url: "/v1/save", headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "PLAYER_BANNED", msg: "异常行为" });
    } finally {
      await bannedApp.close();
    }
  });

  it("revision 冲突时返回 409 和云端摘要", async () => {
    await app.inject({ method: "PUT", url: "/v1/save", headers: { authorization: `Bearer ${token}` }, payload });
    const conflict = await app.inject({
      method: "PUT",
      url: "/v1/save",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, idempotencyKey: "api-request-key-0002" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "SAVE_CONFLICT", data: { current: { revision: 1 } } });
  });

  it("相同幂等请求重放不重复递增 revision", async () => {
    const first = await app.inject({
      method: "PUT",
      url: "/v1/save",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const replay = await app.inject({
      method: "PUT",
      url: "/v1/save",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(first.json()).toMatchObject({ data: { revision: 1, duplicate: false } });
    expect(replay.json()).toMatchObject({ data: { revision: 1, duplicate: true } });
  });

  it("数据库或配额异常返回脱敏 500 和可追踪 requestId", async () => {
    const sessions = new InMemorySessionRepository();
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-1",
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    const failingRepository: CloudSaveRepository = {
      findByPlayerId: () => Promise.reject(new Error("quota exhausted: secret-internal-detail")),
      compareAndSet: () => Promise.reject(new Error("quota exhausted: secret-internal-detail")),
      rollbackPrevious: () => Promise.reject(new Error("quota exhausted: secret-internal-detail")),
    };
    const failingApp = buildApp({
      config,
      now: () => 2_000,
      cloudSaveService: new CloudSaveService({ sessions, saves: failingRepository, now: () => 2_000 }),
    });

    try {
      const response = await failingApp.inject({
        method: "GET",
        url: "/v1/save",
        headers: {
          authorization: `Bearer ${token}`,
          "x-request-id": "p4-quota-failure-request",
        },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: "INTERNAL_ERROR",
        msg: "服务器内部错误",
        timestamp: 2_000,
        requestId: "p4-quota-failure-request",
      });
      expect(response.body).not.toContain("secret-internal-detail");
      expect(response.body).not.toContain(token);
    } finally {
      await failingApp.close();
    }
  });
});
