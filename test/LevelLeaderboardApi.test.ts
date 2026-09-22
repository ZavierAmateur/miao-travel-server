import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { CloudBaseLevelLeaderboardRepository } from "../src/infrastructure/repositories/CloudBaseLevelLeaderboardRepository.js";
import type { CloudBaseCollectionReference, CloudBaseQueryReference } from "../src/infrastructure/persistence/CloudBaseDatabase.js";

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
        platform: index % 2 === 0 ? PlatformKind.WeChat : PlatformKind.ByteDance,
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

  it("按微信昵称、平台和用户ID筛选并保留全榜真实名次", async () => {
    const nickname = await app!.inject({
      method: "GET", url: "/admin/v1/leaderboards/level?page=1&nickName=%E6%97%85%E8%A1%8C%E8%80%852",
      headers: { cookie },
    });
    expect(nickname.statusCode).toBe(200);
    expect(nickname.json<LeaderboardResponseBody>().data.items.map((item) => item.rank))
      .toEqual([2, 20, 21, 22, 23, 24, 25]);

    const platform = await app!.inject({
      method: "GET", url: "/admin/v1/leaderboards/level?page=1&platform=bytedance",
      headers: { cookie },
    });
    expect(platform.statusCode).toBe(200);
    expect(platform.json<LeaderboardResponseBody>().data.items.map((item) => item.rank))
      .toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);

    const combined = await app!.inject({
      method: "GET",
      url: "/admin/v1/leaderboards/level?page=1&playerId=player-07&platform=wechat&nickName=%E6%97%85%E8%A1%8C",
      headers: { cookie },
    });
    expect(combined.statusCode).toBe(200);
    expect(combined.json<LeaderboardResponseBody>().data.items).toEqual([
      expect.objectContaining({ rank: 7, playerId: "player-07", platform: "wechat" }),
    ]);
  });

  it("筛选后仍按20条分页并校验非法筛选条件", async () => {
    const noMatch = await app!.inject({
      method: "GET", url: "/admin/v1/leaderboards/level?page=1&playerId=missing-player",
      headers: { cookie },
    });
    const invalidPlatform = await app!.inject({
      method: "GET", url: "/admin/v1/leaderboards/level?page=1&platform=web",
      headers: { cookie },
    });
    expect(noMatch.statusCode).toBe(200);
    expect(noMatch.json<LeaderboardResponseBody>().data).toMatchObject({ items: [], hasMore: false, pageSize: 20 });
    expect(invalidPlatform.statusCode).toBe(400);
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

describe("CloudBase闯关榜筛选", () => {
  it("跨批次扫描筛选结果并保留全榜名次", async () => {
    const documents = Array.from({ length: 130 }, (_, index) => ({
      playerId: `player-${String(index + 1).padStart(3, "0")}`,
      platform: index % 2 === 0 ? "wechat" : "bytedance",
      level: 200 - index,
      nickName: index === 119 ? "目标旅行猫" : `旅行者${index + 1}`,
      avatarUrl: "",
      reachedAt: 1_000 + index,
      scoreUpdatedAt: 1_000 + index,
      updatedAt: 1_000 + index,
      sortKey: String(index),
    }));
    let offset = 0;
    let limit = 100;
    const get = vi.fn(() => Promise.resolve({ requestId: "query", data: documents.slice(offset, offset + limit) }));
    const query = {
      orderBy: vi.fn(() => query),
      skip: vi.fn((value: number) => { offset = value; return query; }),
      limit: vi.fn((value: number) => { limit = value; return query; }),
      get,
    } as unknown as CloudBaseQueryReference;
    const collection = { where: vi.fn(() => query) } as unknown as CloudBaseCollectionReference;
    const repository = new CloudBaseLevelLeaderboardRepository(collection);

    const result = await repository.list({ offset: 0, limit: 21, playerId: "player-120", nickName: "旅行猫" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rank: 120, entry: { playerId: "player-120" } });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
