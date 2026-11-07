import {isMissingDocument} from "../../infrastructure/persistence/CloudBaseErrors.js";
import {createHash} from "node:crypto";
import type {CloudBaseDatabase, CloudBaseCollectionReference} from "../../infrastructure/persistence/CloudBaseDatabase.js";
import type {CloudSavePayload, CloudSaveRecord, CloudSaveSnapshot, JsonValue} from "./CloudSave.js";
import {CAMPAIGN_SAVE_POLICY as POLICY} from "./CampaignSavePolicy.js";
import {stableStringify} from "./CloudSaveValidation.js";

const PROGRESS_FIELDS = ["level", "levelMaxProgress", "winnerStreakCount", "levelProgressVersion"] as const;
function object(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hash(value: unknown): string { return createHash("sha256").update(stableStringify(value)).digest("hex"); }
/** 排除且仅排除四个玩家进度字段；包括 time、未知模块等其余内容，证明资产未变。 */
export function assetFingerprint(save: CloudSavePayload): string {
  if (!object(save.modules?.user)) throw new Error("存档 user 不是对象，禁止迁移");
  const user = {...save.modules.user};
  for (const field of PROGRESS_FIELDS) delete user[field];
  return hash({...save, modules: {...save.modules, user}});
}
export function migrateProgressSnapshot<T extends CloudSaveSnapshot>(snapshot: T): T {
  if (snapshot.save.generation !== POLICY.generation) return snapshot;
  const user = snapshot.save.modules?.user;
  if (!object(user)) throw new Error("存档 user 不是对象，禁止迁移");
  if (user.levelProgressVersion === POLICY.progressVersion) return snapshot;
  const save: CloudSavePayload = {...snapshot.save, modules: {...snapshot.save.modules, user: {
    ...user, level: POLICY.firstPlayableLevel, levelMaxProgress: 0, winnerStreakCount: 0, levelProgressVersion: POLICY.progressVersion,
  }}};
  if (assetFingerprint(snapshot.save) !== assetFingerprint(save)) throw new Error("资产守恒检查失败");
  const canonical = stableStringify(save);
  return {...snapshot, save, hash: hash(save), sizeBytes: Buffer.byteLength(canonical, "utf8")};
}
/** current 和 previous 分别判断版本，已在新版本继续游玩的 current 永远不重置。 */
export function planProgressReset(before: CloudSaveRecord, now: number): {changed: boolean; record: CloudSaveRecord} {
  if (!Number.isSafeInteger(before.revision) || before.revision < 1) throw new Error("非法 revision，禁止迁移");
  if (before.save.generation !== POLICY.generation) return {changed: false, record: before};
  if (before.previous && before.previous.save.generation !== POLICY.generation) {
    throw new Error("previous generation 不一致，需人工核对后再迁移");
  }
  const current = migrateProgressSnapshot(before), previous = before.previous ? migrateProgressSnapshot(before.previous) : undefined;
  if (current === before && previous === before.previous) return {changed: false, record: before};
  return {changed: true, record: {
    ...current, revision: before.revision + 1, serverSavedAt: now,
    lastIdempotencyKey: `progress-reset:${POLICY.progressVersion}:${before.revision}`,
    lastRequestHash: `progress-reset:${POLICY.progressVersion}:${before.revision}`,
    leaderboardSyncPending: true,
    ...(previous ? {previous} : {}),
  }};
}
export interface ProgressResetOptions {
  readonly apply?: boolean;
  readonly expectedGeneration: string;
  readonly expectedProgressVersion: string;
  readonly expectedTarget: string;
  readonly serverGeneration?: string;
  readonly serverProgressVersion?: string;
  readonly serverTarget?: string;
  /** 回调必须将原始 before（包含 previous）持久写盘并同步；失败即中止，不写该记录。 */
  readonly backup: (entry: Record<string, unknown>) => Promise<void>;
  readonly now?: () => number;
}
async function* rows(collection: CloudBaseCollectionReference): AsyncGenerator<Record<string, JsonValue> & {_id: string}> {
  for (let offset = 0; offset < 1_000_000; offset += 100) {
    const result = await collection.where({}).orderBy("_id", "asc").skip(offset).limit(100).get();
    if (result.code && result.code !== "SUCCESS") throw new Error("扫描失败，禁止继续迁移");
    for (const item of result.data) {
      if (!object(item) || typeof item._id !== "string") throw new Error("数据库记录缺少 _id");
      yield item as Record<string, JsonValue> & {_id: string};
    }
    if (result.data.length < 100) return;
  }
  throw new Error("超过迁移扫描上限");
}
export async function resetCampaignProgress(database: CloudBaseDatabase, options: ProgressResetOptions) {
  if (options.expectedGeneration !== POLICY.generation || options.expectedProgressVersion !== POLICY.progressVersion) throw new Error("本地关卡批次/进度版本不一致");
  if (options.apply && (options.serverGeneration !== options.expectedGeneration || options.serverProgressVersion !== options.expectedProgressVersion)) throw new Error("健康检查关卡批次/进度版本不一致");
  if (options.apply && (!options.expectedTarget || options.serverTarget !== options.expectedTarget)) throw new Error("健康检查数据库目标不一致");
  const now = (options.now ?? Date.now)(), saves = database.collection("cloud_saves"), leaderboard = database.collection("level_leaderboard");
  const report = {mode: options.apply ? "apply" : "dry-run", generation: POLICY.generation, progressVersion: POLICY.progressVersion,
    scanned: 0, changed: 0, updated: 0, skippedGeneration: 0, conflicts: 0, assetProofs: 0, verified: 0, concurrentAdvanced: 0, leaderboardScanned: 0, leaderboardUpdated: 0, leaderboardConflicts: 0, leaderboardOrphans: 0};
  const conflicted = new Set<string>();
  for await (const raw of rows(saves)) {
    report.scanned++;
    const before = {...raw, playerId: raw._id} as unknown as CloudSaveRecord;
    const plan = planProgressReset(before, now);
    if (before.save.generation !== POLICY.generation) report.skippedGeneration++;
    const fingerprints = before.save.generation === POLICY.generation ? {
      currentBefore: assetFingerprint(before.save), currentAfter: assetFingerprint(plan.record.save),
      ...(before.previous ? {previousBefore: assetFingerprint(before.previous.save), previousAfter: assetFingerprint(plan.record.previous!.save)} : {}),
    } : undefined;
    // 原始整条文档（含 current 和 previous）先写备份。绝不删除 cloud_saves。
    await options.backup({collection: "cloud_saves", id: raw._id, before: raw, changed: plan.changed, ...(fingerprints ? {fingerprints} : {})});
    if (!plan.changed) continue;
    report.changed++; report.assetProofs += before.previous ? 2 : 1;
    if (!options.apply) continue;
    const next = plan.record;
    const result = await saves.where({_id: raw._id, revision: before.revision}).update({
      revision: next.revision, serverSavedAt: next.serverSavedAt, hash: next.hash, sizeBytes: next.sizeBytes,
      save: database.command.set(next.save), lastIdempotencyKey: next.lastIdempotencyKey, lastRequestHash: next.lastRequestHash,
      leaderboardSyncPending: true, ...(next.previous ? {previous: database.command.set(next.previous)} : {}),
    });
    if (result.code && result.code !== "SUCCESS") throw new Error("进度 CAS 更新失败");
    if (result.updated !== 1) { report.conflicts++; conflicted.add(raw._id); continue; }
    report.updated++;
    const persisted = (await saves.doc(raw._id).get()).data[0] as CloudSaveRecord | undefined;
    if (persisted && persisted.revision > next.revision) { report.concurrentAdvanced++; continue; }
    if (!persisted || persisted.revision !== next.revision || hash(persisted.save) !== next.hash
      || persisted.hash !== next.hash || persisted.sizeBytes !== next.sizeBytes
      || assetFingerprint(persisted.save) !== assetFingerprint(before.save)
      || (next.previous && (!persisted.previous || stableStringify(persisted.previous) !== stableStringify(next.previous)))) {
      throw new Error("落库存档摘要或资产守恒检查失败，立即停止并保留备份");
    }
    report.verified++;
  }
  for await (const before of rows(leaderboard)) {
    report.leaderboardScanned++;
    await options.backup({collection: "level_leaderboard", id: before._id, before});
    if (before.progressVersion === POLICY.progressVersion || conflicted.has(before._id)) continue;
    // 读取最新云档，避免重跑工具把已玩新版的用户投影拉回第6关。
    let latest: CloudSaveRecord | undefined;
    try {
      latest = (await saves.doc(before._id).get()).data[0] as CloudSaveRecord | undefined;
    } catch (error) {
      if (!isMissingDocument(error)) throw error;
    }
    // 孤立排行榜不能推断玩家进度；已备份，保留原记录供人工核对。
    if (!latest) { report.leaderboardOrphans++; continue; }
    const user = latest?.save?.modules?.user;
    const level = object(user) && user.levelProgressVersion === POLICY.progressVersion && Number.isSafeInteger(user.level)
      ? user.level as number : POLICY.firstPlayableLevel;
    if (!options.apply) continue;
    const reachedAt = before.level === level && typeof before.reachedAt === "number" ? before.reachedAt : now;
    const scoreUpdatedAt = Math.max(now, typeof latest?.serverSavedAt === "number" ? latest.serverSavedAt : 0);
    const sortKey = `${String(1_000_000 - level).padStart(7, "0")}:${String(reachedAt).padStart(16, "0")}:${before._id}`;
    const result = await leaderboard.where({_id: before._id, level: before.level, scoreUpdatedAt: before.scoreUpdatedAt}).update({
      level, reachedAt, scoreUpdatedAt, sortKey, progressVersion: POLICY.progressVersion,
    });
    if (result.code && result.code !== "SUCCESS") throw new Error("排行榜 CAS 更新失败");
    if (result.updated === 1) report.leaderboardUpdated++; else report.leaderboardConflicts++;
  }
  return report;
}
