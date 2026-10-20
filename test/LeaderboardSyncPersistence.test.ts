import { describe, expect, it } from "vitest";
import { validateCloudSaveInput } from "../src/domain/save/CloudSaveValidation.js";
import type { CloudBaseCollectionReference, CloudBaseQueryReference } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { CloudBaseCloudSaveRepository } from "../src/infrastructure/repositories/CloudBaseCloudSaveRepository.js";
import { CloudBasePlayerProfileRepository } from "../src/infrastructure/repositories/CloudBasePlayerProfileRepository.js";

/** 模拟同一数据库在仓储重建后的单文档条件更新，全部使用内存数据。 */
function collection() {
  const records = new Map<string, Record<string, unknown>>();
  const requestId = "test-request";
  const port: CloudBaseCollectionReference = {
    aggregate: () => { throw new Error("本测试不使用聚合"); },
    doc: id => ({
      get: () => Promise.resolve({ requestId, data: records.has(id) ? [structuredClone(records.get(id))] : [] }),
      set: data => { records.set(id, { ...structuredClone(data), _id: id }); return Promise.resolve({ requestId }); },
      remove: () => { records.delete(id); return Promise.resolve({ requestId }); },
    }),
    add: data => {
      const record = structuredClone(data) as Record<string, unknown>;
      records.set(String(record._id), record); return Promise.resolve({ requestId });
    },
    where: query => {
      const fields = query as Record<string, unknown>;
      const matched = () => [...records.values()].filter(row => Object.entries(fields).every(([k,v]) => row[k] === v));
      let offset = 0, limit = Infinity;
      const reference: CloudBaseQueryReference = {
        count: () => Promise.resolve({ requestId, total: matched().length }),
        get: () => Promise.resolve({ requestId, data: matched()
          .sort((a,b) => String(a._id).localeCompare(String(b._id))).slice(offset,offset+limit).map(row => structuredClone(row)) }),
        update: data => {
          const rows = matched();
          for (const row of rows) for (const [key,value] of Object.entries(data)) {
            row[key] = typeof value === "object" && value !== null && "$set" in value
              ? structuredClone((value as { $set: unknown }).$set) : structuredClone(value);
          }
          return Promise.resolve({ requestId, updated: rows.length });
        },
        limit: count => { limit=count; return reference; },
        skip: count => { offset=count; return reference; },
        orderBy: () => reference,
      };
      return reference;
    },
  };
  return { records, port };
}
const command = { set: (value: unknown) => ({ $set: value }) };
function save(baseRevision=0, level=14) {
  return { playerId: "player-1", serverSavedAt: 1000+baseRevision, ...validateCloudSaveInput({
    baseRevision, clientVersion: "1", clientSavedAt: 100, idempotencyKey: `sync-save-${baseRevision}`,
    save: { version: "1", serialized: 1, time: 100, modules: { user: { level, hintCount: 7 } } },
  }) };
}

describe("排行榜待同步标记的 CloudBase 持久化", () => {
  it("主存档首次写入和条件更新同时保存标记，仓储重建后可查询补偿", async () => {
    const db=collection(); const repo=new CloudBaseCloudSaveRepository(db.port,command);
    await repo.compareAndSet(save());
    expect(db.records.get("player-1")).toMatchObject({ revision:1,leaderboardSyncPending:true });
    expect(await repo.markLeaderboardSynced("player-1",1)).toBe(true);
    await repo.compareAndSet(save(1,15));
    const restarted=new CloudBaseCloudSaveRepository(db.port,command);
    expect(await restarted.listPendingLeaderboardSync(20,0)).toMatchObject([
      { playerId:"player-1",revision:2,leaderboardSyncPending:true,save:{modules:{user:{level:15,hintCount:7}}} },
    ]);
  });

  it("旧版本确认不清理新存档标记；确认成功也不改变版本、哈希或存档内容", async () => {
    const db=collection(); const repo=new CloudBaseCloudSaveRepository(db.port,command);
    await repo.compareAndSet(save()); await repo.compareAndSet(save(1,15));
    const before=await repo.findByPlayerId("player-1");
    expect(await repo.markLeaderboardSynced("player-1",1)).toBe(false);
    expect(await repo.markLeaderboardSynced("player-1",2)).toBe(true);
    expect(await repo.findByPlayerId("player-1")).toEqual({ ...before,leaderboardSyncPending:false });
    expect(await repo.listPendingLeaderboardSync(20,0)).toEqual([]);
  });

  it("后台回滚也会原子记录待同步，下一次可以投影回退后的关卡", async () => {
    const db=collection(); const repo=new CloudBaseCloudSaveRepository(db.port,command);
    await repo.compareAndSet(save()); await repo.compareAndSet(save(1,15));
    await repo.markLeaderboardSynced("player-1",2);
    await repo.rollbackPrevious({playerId:"player-1",expectedRevision:2,serverSavedAt:2000,auditKey:"rollback-test"});
    expect(await repo.listPendingLeaderboardSync(20,0)).toMatchObject([
      { revision:3,leaderboardSyncPending:true,save:{modules:{user:{level:14}}} },
    ]);
  });

  it("资料与待同步标记同次写入；同时间不同资料的旧确认不能清理新修改", async () => {
    const db=collection(); const repo=new CloudBasePlayerProfileRepository(db.port);
    const old={playerId:"player-1",nickName:"旧昵称",avatarUrl:"https://example.com/old.webp",updatedAt:1000};
    await repo.save(old);
    const newer={...old,nickName:"新昵称",avatarUrl:"https://example.com/new.webp"}; await repo.save(newer);
    expect(db.records.get("player-1")).toMatchObject({ nickName:newer.nickName,avatarUrl:newer.avatarUrl,updatedAt:1000,leaderboardSyncPending:true });
    const restarted=new CloudBasePlayerProfileRepository(db.port);
    expect(await restarted.listPendingLeaderboardSync(20,0)).toMatchObject([{...newer,leaderboardSyncPending:true}]);
    expect(await restarted.markLeaderboardSynced(old)).toBe(false);
    expect(await restarted.markLeaderboardSynced(newer)).toBe(true);
    expect(await restarted.listPendingLeaderboardSync(20,0)).toEqual([]);
  });

  it("缺少标记的历史文档正常读取，不触发全量回填", async () => {
    const db=collection(); const repo=new CloudBaseCloudSaveRepository(db.port,command);
    await repo.compareAndSet(save()); delete db.records.get("player-1")!.leaderboardSyncPending;
    expect(await repo.findByPlayerId("player-1")).toMatchObject({revision:1,leaderboardSyncPending:false});
    expect(await repo.listPendingLeaderboardSync(20,0)).toEqual([]);
  });
});
