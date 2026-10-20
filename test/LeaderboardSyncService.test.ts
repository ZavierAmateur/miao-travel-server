import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { CloudSaveService } from "../src/domain/save/CloudSaveService.js";
import { PlayerProfileService } from "../src/domain/profile/PlayerProfileService.js";
import { LeaderboardSyncService } from "../src/domain/leaderboard/LeaderboardSyncService.js";
import { LevelLeaderboardProjector } from "../src/domain/leaderboard/LevelLeaderboardProjector.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import { InMemoryPlayerProfileRepository } from "../src/infrastructure/repositories/InMemoryPlayerProfileRepository.js";
import { InMemoryLevelLeaderboardRepository } from "../src/infrastructure/repositories/InMemoryLevelLeaderboardRepository.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";

const config: AppConfig = {
  environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "audit-app", appSecret: "test-secret", logLevel: "error",
  persistenceDriver: PersistenceDriver.Memory, cloudbaseEnvId: "", cloudbaseRegion: "",
  cloudbaseApiKey: "", cloudbaseDatabaseInstance: "", cloudDatabaseName: "",
};
const token = "leaderboard-retry-token";
const headers = { authorization: `Bearer ${token}` };
const profile = { nickName: "旅行猫", avatarUrl: "https://example.com/avatar.webp" };
function input(baseRevision = 0, level = 14) {
  return {
    baseRevision, clientVersion: "1", clientSavedAt: 100,
    idempotencyKey: `leaderboard-save-${baseRevision}`,
    save: { version: "1", serialized: 1, time: 100, modules: { user: { level, hintCount: 7 } } },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function fixture(batchSize = 20) {
  const saves = new InMemoryCloudSaveRepository();
  const profiles = new InMemoryPlayerProfileRepository();
  const leaderboard = new InMemoryLevelLeaderboardRepository();
  const sessions = new InMemorySessionRepository();
  const players = new InMemoryPlayerRepository();
  await players.save({
    id: "player-1", platform: PlatformKind.WeChat, appId: "test", platformOpenId: "openid",
    status: "active", createdAt: 1, lastLoginAt: 1,
  });
  await sessions.save({ tokenHash: createHash("sha256").update(token).digest("hex"),
    playerId: "player-1", createdAt: 1, expiresAt: 10000 });
  const projector = new LevelLeaderboardProjector({ players, profiles, leaderboard });
  const failures = vi.fn();
  const makeSync = () => new LeaderboardSyncService({ saves, profiles, projector, batchSize, onError: failures });
  const worker = makeSync();
  const notification = { requestSync: vi.fn() };
  const cloudSaveService = new CloudSaveService({ saves, sessions, players, leaderboardSync: notification, now: () => 1000 });
  const playerProfileService = new PlayerProfileService({ profiles, sessions, players, leaderboardSync: notification, now: () => 1100 });
  const app = buildApp({ config, cloudSaveService, playerProfileService });
  return { saves, profiles, leaderboard, projector, failures, worker, makeSync, notification, app, cloudSaveService, playerProfileService };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("排行榜故障与主数据保存隔离", () => {
  it("排行榜故障时存档和资料接口仍返回200，主数据可读取且待同步标记保留", async () => {
    const h = await fixture();
    vi.spyOn(h.projector, "syncSave").mockRejectedValue(new Error("rank unavailable"));
    vi.spyOn(h.projector, "syncProfile").mockRejectedValue(new Error("rank unavailable"));
    try {
      const saved = await h.app.inject({ method: "PUT", url: "/v1/save", headers, payload: input() });
      const edited = await h.app.inject({ method: "PUT", url: "/v1/profile", headers, payload: profile });
      expect(saved.statusCode).toBe(200); expect(edited.statusCode).toBe(200);
      await h.worker.runOnce();
      expect(h.failures).toHaveBeenCalledTimes(2);
      expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ revision: 1, leaderboardSyncPending: true });
      expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({ ...profile, leaderboardSyncPending: true });
      const saveGet = await h.app.inject({ method: "GET", url: "/v1/save", headers });
      const profileGet = await h.app.inject({ method: "GET", url: "/v1/profile", headers });
      expect(saveGet.json()).toMatchObject({ code: 0, data: { revision: 1, save: { modules: { user: { level: 14, hintCount: 7 } } } } });
      expect(profileGet.json()).toMatchObject({ code: 0, data: { exists: true, ...profile } });
      expect(saveGet.body + profileGet.body).not.toContain("leaderboardSyncPending");
      const duplicate = await h.app.inject({ method: "PUT", url: "/v1/save", headers, payload: input() });
      expect(duplicate.json()).toMatchObject({ data: { revision: 1, duplicate: true } });
    } finally { await h.worker.stop(); await h.app.close(); }
  });

  it("故障恢复后新建后台任务仍可补偿，两份主数据不需要客户端重新上传", async () => {
    const h = await fixture();
    await h.cloudSaveService.put(`Bearer ${token}`, input());
    await h.playerProfileService.put(`Bearer ${token}`, profile);
    const failure = vi.spyOn(h.leaderboard, "upsertScore").mockRejectedValue(new Error("rank unavailable"));
    await h.worker.runOnce(); await h.worker.stop();
    failure.mockRestore();
    const restarted = h.makeSync(); await restarted.runOnce();
    expect(await h.leaderboard.findByPlayerId("player-1")).toMatchObject({ level: 14, ...profile });
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ revision: 1, leaderboardSyncPending: false });
    expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({ leaderboardSyncPending: false });
    const syncSave = vi.spyOn(h.projector, "syncSave"); await restarted.runOnce();
    expect(syncSave).not.toHaveBeenCalled();
    await restarted.stop(); await h.app.close();
  });

  it("排行榜请求挂起时主保存仍完成；多个同步触发共用一个任务", async () => {
    const h = await fixture(); const pending = deferred(); const started = deferred();
    vi.spyOn(h.projector, "syncSave").mockImplementation(async () => { started.resolve(); await pending.promise; });
    try {
      await expect(h.cloudSaveService.put(`Bearer ${token}`, input())).resolves.toMatchObject({ revision: 1 });
      const running = h.worker.runOnce(); await started.promise;
      expect(h.worker.runOnce()).toBe(running);
      await expect(h.playerProfileService.put(`Bearer ${token}`, profile)).resolves.toMatchObject(profile);
      expect(h.notification.requestSync).toHaveBeenCalledTimes(2);
      pending.resolve(); await running;
    } finally { pending.resolve(); await h.worker.stop(); await h.app.close(); }
  });

  it("主存档写入失败或版本冲突时维持原有错误，不唤醒排行榜任务", async () => {
    const h = await fixture();
    try {
      await h.cloudSaveService.put(`Bearer ${token}`, input()); h.notification.requestSync.mockClear();
      const conflict = await h.app.inject({ method: "PUT", url: "/v1/save", headers,
        payload: { ...input(), idempotencyKey: "another-save-key" } });
      expect(conflict.statusCode).toBe(409); expect(h.notification.requestSync).not.toHaveBeenCalled();
      vi.spyOn(h.saves, "compareAndSet").mockRejectedValue(new Error("primary storage unavailable"));
      await expect(h.cloudSaveService.put(`Bearer ${token}`, input(1))).rejects.toThrow("primary storage unavailable");
      expect(h.notification.requestSync).not.toHaveBeenCalled();
    } finally { await h.worker.stop(); await h.app.close(); }
  });
});

describe("补偿任务确认与生命周期", () => {
  it("任务唤醒失败也不改变成功响应，标记仍可由后续扫描补偿", async () => {
    const h = await fixture(); vi.spyOn(console, "warn").mockImplementation(() => {});
    h.notification.requestSync.mockImplementation(() => { throw new Error("scheduler unavailable"); });
    try {
      const saved = await h.app.inject({ method: "PUT", url: "/v1/save", headers, payload: input() });
      const edited = await h.app.inject({ method: "PUT", url: "/v1/profile", headers, payload: profile });
      expect(saved.statusCode).toBe(200); expect(edited.statusCode).toBe(200);
      expect(await h.saves.findByPlayerId("player-1")).toMatchObject({leaderboardSyncPending:true});
      await h.worker.runOnce();
      expect(await h.leaderboard.findByPlayerId("player-1")).toMatchObject({level:14,...profile});
    } finally { await h.worker.stop(); await h.app.close(); }
  });

  it("真实唤醒在后台更新榜单，主请求不等待投影", async () => {
    const h = await fixture(); vi.useFakeTimers();
    h.notification.requestSync.mockImplementation(() => h.worker.requestSync());
    try {
      await expect(h.cloudSaveService.put(`Bearer ${token}`,input())).resolves.toMatchObject({revision:1});
      expect(await h.leaderboard.findByPlayerId("player-1")).toBeUndefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(await h.leaderboard.findByPlayerId("player-1")).toMatchObject({level:14});
    } finally { await h.worker.stop(); await h.app.close(); }
  });

  it("关闭服务等待当前投影结束，未开始的资料任务保留供重启补偿", async () => {
    const h=await fixture(); await h.cloudSaveService.put(`Bearer ${token}`,input());
    await h.playerProfileService.put(`Bearer ${token}`,profile);
    const pending=deferred(), started=deferred();
    const original=h.projector.syncSave.bind(h.projector);
    vi.spyOn(h.projector,"syncSave").mockImplementationOnce(async (...args) => {
      started.resolve(); await pending.promise; await original(...args);
    });
    const running=h.worker.runOnce(); await started.promise;
    const stopped=h.worker.stop(); pending.resolve(); await stopped; await running;
    expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({leaderboardSyncPending:true});
    const restarted=h.makeSync(); await restarted.runOnce();
    expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({leaderboardSyncPending:false});
    await restarted.stop(); await h.app.close();
  });

  it("旧存档任务完成时不能清除新版本标记，下一轮同步最新关卡", async () => {
    const h = await fixture(); await h.cloudSaveService.put(`Bearer ${token}`, input());
    const original = h.projector.syncSave.bind(h.projector);
    const call = vi.spyOn(h.projector, "syncSave").mockImplementationOnce(async (...args) => {
      await h.cloudSaveService.put(`Bearer ${token}`, input(1, 15)); await original(...args);
    });
    await h.worker.runOnce();
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ revision: 2, leaderboardSyncPending: true });
    await h.worker.runOnce();
    expect(call).toHaveBeenCalledTimes(2);
    expect(await h.leaderboard.findByPlayerId("player-1")).toMatchObject({ level: 15 });
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ leaderboardSyncPending: false });
    await h.worker.stop(); await h.app.close();
  });

  it("同一毫秒修改资料后，旧资料任务不能清掉新内容的标记", async () => {
    const h = await fixture(); await h.playerProfileService.put(`Bearer ${token}`, profile);
    const newer = { nickName: "新昵称", avatarUrl: "https://example.com/new.webp" };
    vi.spyOn(h.projector, "syncProfile").mockImplementationOnce(async () => {
      await h.playerProfileService.put(`Bearer ${token}`, newer);
    });
    await h.worker.runOnce();
    expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({ ...newer, leaderboardSyncPending: true });
    await h.worker.runOnce();
    expect(await h.profiles.findByPlayerId("player-1")).toMatchObject({ ...newer, leaderboardSyncPending: false });
    await h.worker.stop(); await h.app.close();
  });

  it("启动主动补偿、定时重试；关闭后停止任务，未完成记录仍保留", async () => {
    const h = await fixture(); await h.cloudSaveService.put(`Bearer ${token}`, input());
    const failure = vi.spyOn(h.projector, "syncSave").mockRejectedValue(new Error("offline"));
    vi.useFakeTimers(); h.worker.start(); await vi.advanceTimersByTimeAsync(0);
    expect(failure).toHaveBeenCalledTimes(1);
    failure.mockRestore(); await vi.advanceTimersByTimeAsync(30001);
    expect(await h.leaderboard.findByPlayerId("player-1")).toMatchObject({ level: 14 });
    await h.worker.stop(); const sync = vi.spyOn(h.projector, "syncSave");
    await h.cloudSaveService.put(`Bearer ${token}`, input(1, 15));
    h.worker.requestSync(); await vi.advanceTimersByTimeAsync(60000);
    expect(sync).not.toHaveBeenCalled();
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ leaderboardSyncPending: true });
    await h.app.close();
  });

  it("失败玩家不会阻断后续玩家；一个来源查询失败不阻断另一个来源", async () => {
    const h = await fixture(1);
    await h.profiles.save({ playerId: "a", ...profile, updatedAt: 1 });
    await h.profiles.save({ playerId: "b", ...profile, updatedAt: 1 });
    const call = vi.spyOn(h.projector, "syncProfile").mockImplementation(p => p.playerId === "a" ? Promise.reject(new Error("bad player")) : Promise.resolve());
    vi.spyOn(h.saves, "listPendingLeaderboardSync").mockRejectedValue(new Error("save list unavailable"));
    await h.worker.runOnce(); await h.worker.runOnce();
    expect(call.mock.calls.map(([p]) => p.playerId)).toEqual(["a", "b"]);
    expect(await h.profiles.findByPlayerId("b")).toMatchObject({ leaderboardSyncPending: false });
    expect(await h.profiles.findByPlayerId("a")).toMatchObject({ leaderboardSyncPending: true });
    await h.worker.stop(); await h.app.close();
  });

  it("同步成功但确认写入失败时保留任务，重新执行不改变主存档版本", async () => {
    const h = await fixture(); await h.cloudSaveService.put(`Bearer ${token}`, input());
    const ack = vi.spyOn(h.saves, "markLeaderboardSynced").mockRejectedValueOnce(new Error("ack unavailable"));
    await h.worker.runOnce();
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ revision: 1, leaderboardSyncPending: true });
    await h.worker.runOnce(); expect(ack).toHaveBeenCalledTimes(2);
    expect(await h.saves.findByPlayerId("player-1")).toMatchObject({ revision: 1, leaderboardSyncPending: false });
    await h.worker.stop(); await h.app.close();
  });
});
