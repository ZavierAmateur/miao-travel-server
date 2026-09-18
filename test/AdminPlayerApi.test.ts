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
  let audits: InMemoryAdminAuditRepository;
  let users: InMemoryAdminUserRepository;
  let players: InMemoryPlayerRepository;
  let saves: InMemoryCloudSaveRepository;

  beforeEach(async () => {
    users = new InMemoryAdminUserRepository();
    audits = new InMemoryAdminAuditRepository();
    const auth = new AdminAuthService({
      users, sessions: new InMemoryAdminSessionRepository(), audits,
      now: () => 20_000, createToken: () => "player-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    players = new InMemoryPlayerRepository();
    await players.save({
      id: "player-1", platform: PlatformKind.WeChat, appId: "wx-app", platformOpenId: "secret-open-id",
      status: "active", createdAt: 1_000, lastLoginAt: 2_000,
    });
    const profiles = new InMemoryPlayerProfileRepository();
    await profiles.save({ playerId: "player-1", nickName: "旅行猫", avatarUrl: "https://example.com/avatar.png", updatedAt: 2_100 });
    saves = new InMemoryCloudSaveRepository();
    await saves.compareAndSet({
      playerId: "player-1", baseRevision: 0, clientVersion: "1.2.0", clientSavedAt: 2_200,
      idempotencyKey: "idempotency-1", requestHash: "request-hash", hash: "save-hash", sizeBytes: 128,
      save: { version: "1", serialized: 1, time: 2_200, modules: { user: { level: 8 } } }, serverSavedAt: 2_300,
    });
    await saves.compareAndSet({
      playerId: "player-1", baseRevision: 1, clientVersion: "1.3.0", clientSavedAt: 2_400,
      idempotencyKey: "idempotency-2", requestHash: "request-hash-2", hash: "save-hash-2", sizeBytes: 144,
      save: { version: "1", serialized: 1, time: 2_400, modules: { user: { level: 9, gold: 100 } } }, serverSavedAt: 2_500,
    });
    const adminPlayers = new AdminPlayerService({ auth, players, profiles, saves, audits, now: () => 20_000 });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, adminPlayerService: adminPlayers, now: () => 20_000 });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("按条件查询玩家并只返回存档摘要", async () => {
    const response = await app!.inject({ method: "GET", url: "/admin/v1/players?platform=wechat&status=active", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { items: [{ id: "player-1", save: { revision: 2, clientVersion: "1.3.0" } }], nextCursor: null } });
    expect(response.body).not.toContain("secret-open-id");
    expect(response.body).not.toContain("modules");
  });

  it("读取玩家详情和资料，不暴露平台身份与存档正文", async () => {
    const response = await app!.inject({ method: "GET", url: "/admin/v1/players/player-1", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: {
      id: "player-1", profile: { nickName: "旅行猫" }, save: { revision: 2, sizeBytes: 144 },
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

  it("读取当前与上一版差异，并用 expectedRevision 原子回滚为新 revision", async () => {
    const diagnostics = await app!.inject({ method: "GET", url: "/admin/v1/players/player-1/save", headers: { cookie } });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({ data: {
      current: { revision: 2, user: { level: 9, gold: 100 } },
      previous: { revision: 1, user: { level: 8 } },
      changes: [{ field: "gold", previous: null, current: 100 }, { field: "level", previous: 8, current: 9 }],
    } });

    const rollback = await app!.inject({
      method: "POST", url: "/admin/v1/players/player-1/save-rollback", headers: { cookie },
      payload: { expectedRevision: 2, reason: "误覆盖恢复" },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json()).toMatchObject({ data: { sourceRevision: 1, revision: 3 } });
    await expect(saves.findByPlayerId("player-1")).resolves.toMatchObject({ revision: 3, save: { modules: { user: { level: 8 } } } });
    expect(audits.logs).toContainEqual(expect.objectContaining({ action: "save.rollback", targetPlayerId: "player-1", reason: "误覆盖恢复" }));

    const stale = await app!.inject({
      method: "POST", url: "/admin/v1/players/player-1/save-rollback", headers: { cookie },
      payload: { expectedRevision: 2, reason: "重复回滚" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "SAVE_ROLLBACK_CONFLICT" });
  });

  it("临时封禁与解封写入玩家状态和审计", async () => {
    const ban = await app!.inject({
      method: "POST", url: "/admin/v1/players/player-1/ban", headers: { cookie },
      payload: { type: "temporary", expiresAt: 80_000, reason: "异常行为", note: "工单 12" },
    });
    expect(ban.statusCode).toBe(200);
    await expect(players.findById("player-1")).resolves.toMatchObject({ status: "banned", banReason: "异常行为", banExpiresAt: 80_000 });

    const unban = await app!.inject({
      method: "POST", url: "/admin/v1/players/player-1/unban", headers: { cookie },
      payload: { reason: "复核通过" },
    });
    expect(unban.statusCode).toBe(200);
    await expect(players.findById("player-1")).resolves.toMatchObject({ status: "active" });
    expect(audits.logs.map((log) => log.action)).toEqual(expect.arrayContaining(["player.ban", "player.unban"]));
  });

  it("运营角色不能执行永久封禁", async () => {
    const user = await users.findByAccount("root.admin");
    expect(user).toBeDefined();
    await users.save({ ...user!, role: "operator" });
    const response = await app!.inject({
      method: "POST", url: "/admin/v1/players/player-1/ban", headers: { cookie },
      payload: { type: "permanent", reason: "严重违规" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "ADMIN_PERMISSION_DENIED" });
  });
});
