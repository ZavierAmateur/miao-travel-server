import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { CloudSaveService } from "../src/domain/save/CloudSaveService.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
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
    expect(loaded.json<{ data: object }>().data).toMatchObject({ exists: true, revision: 1, save: payload.save });
  });

  it("没有 Bearer token 时返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/save" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
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
});
