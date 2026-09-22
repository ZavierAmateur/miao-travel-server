import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AdminLeaderboardService } from "../src/domain/leaderboard/AdminLeaderboardService.js";
import { LevelLeaderboardProjector } from "../src/domain/leaderboard/LevelLeaderboardProjector.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";
import { InMemoryLevelLeaderboardRepository } from "../src/infrastructure/repositories/InMemoryLevelLeaderboardRepository.js";
import { InMemoryPlayerProfileRepository } from "../src/infrastructure/repositories/InMemoryPlayerProfileRepository.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import { CloudSaveService } from "../src/domain/save/CloudSaveService.js";
import { PlayerProfileService } from "../src/domain/profile/PlayerProfileService.js";

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

describe("管理端闯关榜 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;
  let leaderboard: InMemoryLevelLeaderboardRepository;

  beforeEach(async () => {
    const auth = new AdminAuthService({
      users: new InMemoryAdminUserRepository(),
      sessions: new InMemoryAdminSessionRepository(),
      audits: new InMemoryAdminAuditRepository(),
      now: () => 20_000,
      createToken: () => "leaderboard-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    leaderboard = new InMemoryLevelLeaderboardRepository();
    for (let index = 0; index < 25; index += 1) {
      await leaderboard.upsertScore({
        playerId: `player-${String(index + 1).padStart(2, "0")}`,
        platform: PlatformKind.WeChat,
        level: 100 - index,
        nickName: `旅行者${index + 1}`,
        avatarUrl: `https://example.com/${index + 1}.png`,
        updatedAt: 1_000 + index,
      });
    }
    app = buildApp({
      config,
      adminAuthService: auth,
      adminAuthConfig: adminConfig,
      adminLeaderboardService: new AdminLeaderboardService({ auth, leaderboard }),
      now: () => 20_000,
    });
    const login = await app.inject({
      method: "POST", url: "/admin/v1/auth/login",
      payload: { account: "root.admin", password: "correct-password-123" },
    });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("固定每页20条并返回连续排名", async () => {
    const first = await app!.inject({ method: "GET", url: "/admin/v1/leaderboards/level?page=1", headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<LeaderboardResponseBody>();
    expect(firstBody).toMatchObject({ data: { page: 1, pageSize: 20, hasMore: true } });
    expect(firstBody.data.items).toHaveLength(20);
    expect(firstBody.data.items[0]).toMatchObject({ rank: 1, playerId: "player-01", level: 100 });

    const second = await app!.inject({ method: "GET", url: "/admin/v1/leaderboards/level?page=2", headers: { cookie } });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<LeaderboardResponseBody>();
    expect(secondBody).toMatchObject({ data: { page: 2, pageSize: 20, hasMore: false } });
    expect(secondBody.data.items).toHaveLength(5);
    expect(secondBody.data.items[0]).toMatchObject({ rank: 21, playerId: "player-21", level: 80 });
  });

  it("拒绝未登录访问和非法页码", async () => {
    const anonymous = await app!.inject({ method: "GET", url: "/admin/v1/leaderboards/level" });
    const invalid = await app!.inject({ method: "GET", url: "/admin/v1/leaderboards/level?page=0", headers: { cookie } });
    expect(anonymous.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
  });
});

interface LeaderboardResponseBody {
  readonly data: {
    readonly page: number;
    readonly pageSize: number;
    readonly hasMore: boolean;
    readonly items: readonly {
      readonly rank: number;
      readonly playerId: string;
      readonly level: number;
    }[];
  };
}

describe("闯关榜投影", () => {
  it("从云存档同步关卡，并在微信资料更新和存档回滚后保持一致", async () => {
    const players = new InMemoryPlayerRepository();
    const profiles = new InMemoryPlayerProfileRepository();
    const leaderboard = new InMemoryLevelLeaderboardRepository();
    await players.save({
      id: "player-1", platform: PlatformKind.WeChat, appId: "wx-app", platformOpenId: "openid",
      status: "active", createdAt: 1, lastLoginAt: 1,
    });
    await profiles.save({ playerId: "player-1", nickName: "旅行猫", avatarUrl: "https://example.com/a.png", updatedAt: 10 });
    const projector = new LevelLeaderboardProjector({ players, profiles, leaderboard });

    await projector.syncSave("player-1", {
      version: "1", serialized: 1, time: 100, modules: { user: { level: 10 } },
    }, 100);
    await expect(leaderboard.findByPlayerId("player-1")).resolves.toMatchObject({
      level: 10, nickName: "旅行猫", reachedAt: 100,
    });

    await projector.syncProfile({
      playerId: "player-1", nickName: "海岛猫", avatarUrl: "https://example.com/b.png", updatedAt: 200,
    });
    await expect(leaderboard.findByPlayerId("player-1")).resolves.toMatchObject({
      level: 10, nickName: "海岛猫", reachedAt: 100,
    });

    await projector.syncSave("player-1", {
      version: "1", serialized: 1, time: 300, modules: { user: { level: 8 } },
    }, 300);
    await expect(leaderboard.findByPlayerId("player-1")).resolves.toMatchObject({
      level: 8, reachedAt: 300,
    });
  });

  it("云存档与资料服务成功写入后自动刷新榜单", async () => {
    const token = "leaderboard-player-token";
    const players = new InMemoryPlayerRepository();
    const profiles = new InMemoryPlayerProfileRepository();
    const leaderboard = new InMemoryLevelLeaderboardRepository();
    const sessions = new InMemorySessionRepository();
    const saves = new InMemoryCloudSaveRepository();
    await players.save({
      id: "player-2", platform: PlatformKind.WeChat, appId: "wx-app", platformOpenId: "openid-2",
      status: "active", createdAt: 1, lastLoginAt: 1,
    });
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-2", createdAt: 1, expiresAt: 10_000,
    });
    const projector = new LevelLeaderboardProjector({ players, profiles, leaderboard });
    const cloudSaves = new CloudSaveService({ sessions, saves, players, leaderboard: projector, now: () => 2_000 });
    const playerProfiles = new PlayerProfileService({ sessions, profiles, players, leaderboard: projector, now: () => 2_100 });

    await cloudSaves.put(`Bearer ${token}`, {
      baseRevision: 0,
      clientVersion: "1.0.0",
      clientSavedAt: 1_900,
      idempotencyKey: "leaderboard-save-1",
      save: { version: "1.0.0", serialized: 1, time: 1_900, modules: { user: { level: 12 } } },
    });
    await expect(leaderboard.findByPlayerId("player-2")).resolves.toMatchObject({ level: 12, nickName: "" });

    await playerProfiles.put(`Bearer ${token}`, {
      nickName: "云朵旅行者",
      avatarUrl: "https://example.com/cloud.png",
    });
    await expect(leaderboard.findByPlayerId("player-2")).resolves.toMatchObject({
      level: 12, nickName: "云朵旅行者", avatarUrl: "https://example.com/cloud.png",
    });
  });
});
