import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AdminPlayerService } from "../src/domain/admin/AdminPlayerService.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemoryPlayerProfileRepository } from "../src/infrastructure/repositories/InMemoryPlayerProfileRepository.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";

const config: AppConfig = {
  environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "test-app", appSecret: "test-secret",
  logLevel: "error", persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "", cloudbaseRegion: "", cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "", cloudDatabaseName: "",
};

const adminConfig: AdminAuthConfig = {
  enabled: true, bootstrapAccount: "root.admin", bootstrapPassword: "correct-password-123",
  bootstrapDisplayName: "超级管理员", webOrigin: "http://127.0.0.1:5173", secureCookie: false,
};

describe("管理端玩家查询 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;

  beforeEach(async () => {
    const users = new InMemoryAdminUserRepository();
    const auth = new AdminAuthService({
      users, sessions: new InMemoryAdminSessionRepository(), audits: new InMemoryAdminAuditRepository(),
      now: () => 20_000, createToken: () => "player-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    const players = new InMemoryPlayerRepository();
    await players.save({
      id: "player-1", platform: PlatformKind.WeChat, appId: "wx-app", platformOpenId: "secret-open-id",
      status: "active", createdAt: 1_000, lastLoginAt: 2_000,
    });
    const profiles = new InMemoryPlayerProfileRepository();
    await profiles.save({ playerId: "player-1", nickName: "旅行猫", avatarUrl: "https://example.com/avatar.png", updatedAt: 2_100 });
    const saves = new InMemoryCloudSaveRepository();
    await saves.compareAndSet({
      playerId: "player-1", baseRevision: 0, clientVersion: "1.2.0", clientSavedAt: 2_200,
      idempotencyKey: "idempotency-1", requestHash: "request-hash", hash: "save-hash", sizeBytes: 128,
      save: { version: "1", serialized: 1, time: 2_200, modules: { user: { level: 8 } } }, serverSavedAt: 2_300,
    });
    const adminPlayers = new AdminPlayerService({ auth, players, profiles, saves });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, adminPlayerService: adminPlayers, now: () => 20_000 });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("按条件查询玩家并只返回存档摘要", async () => {
    const response = await app!.inject({ method: "GET", url: "/admin/v1/players?platform=wechat&status=active", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { items: [{ id: "player-1", save: { revision: 1, clientVersion: "1.2.0" } }], nextCursor: null } });
    expect(response.body).not.toContain("secret-open-id");
    expect(response.body).not.toContain("modules");
  });

  it("读取玩家详情和资料，不暴露平台身份与存档正文", async () => {
    const response = await app!.inject({ method: "GET", url: "/admin/v1/players/player-1", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: {
      id: "player-1", profile: { nickName: "旅行猫" }, save: { revision: 1, sizeBytes: 128 },
    } });
    expect(response.body).not.toContain("secret-open-id");
    expect(response.body).not.toContain("modules");
  });

  it("拒绝未登录访问并校验游标", async () => {
    const anonymous = await app!.inject({ method: "GET", url: "/admin/v1/players" });
    expect(anonymous.statusCode).toBe(401);
    const invalidCursor = await app!.inject({ method: "GET", url: "/admin/v1/players?cursor=broken", headers: { cookie } });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({ code: "INVALID_CURSOR" });
  });
});
