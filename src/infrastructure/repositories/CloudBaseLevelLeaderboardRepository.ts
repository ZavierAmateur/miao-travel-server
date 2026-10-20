import type { LevelLeaderboardEntry, LevelLeaderboardListQuery, RankedLevelLeaderboardEntry, UpsertLevelScoreCommand } from "../../domain/leaderboard/LevelLeaderboard.js";
import type { LevelLeaderboardRepository } from "../../domain/leaderboard/LevelLeaderboardRepository.js";
import type { CloudBaseCollectionReference, CloudBaseDatabase } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

interface LevelLeaderboardDocument extends LevelLeaderboardEntry {
  readonly sortKey: string;
}

export class CloudBaseLevelLeaderboardRepository implements LevelLeaderboardRepository {
  constructor(
    private readonly collection: CloudBaseCollectionReference,
    private readonly database: Pick<CloudBaseDatabase, "command" | "RegExp">,
  ) {}

  async findByPlayerId(playerId: string): Promise<LevelLeaderboardEntry | undefined> {
    try {
      const result = await this.collection.doc(playerId).get();
      return toEntry(result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }

  async upsertScore(command: UpsertLevelScoreCommand): Promise<LevelLeaderboardEntry> {
    const current = await this.findByPlayerId(command.playerId);
    if (current && current.scoreUpdatedAt > command.updatedAt) return current;
    const entry: LevelLeaderboardEntry = {
      playerId: command.playerId,
      platform: command.platform,
      level: command.level,
      nickName: command.nickName,
      avatarUrl: command.avatarUrl,
      reachedAt: current?.level === command.level ? current.reachedAt : command.updatedAt,
      scoreUpdatedAt: command.updatedAt,
      updatedAt: Math.max(current?.updatedAt ?? 0, command.updatedAt),
    };
    await this.collection.doc(command.playerId).set(toDocument(entry));
    return entry;
  }

  async updateProfile(playerId: string, profile: { readonly nickName: string; readonly avatarUrl: string; readonly updatedAt: number }): Promise<void> {
    const current = await this.findByPlayerId(playerId);
    if (!current) return;
    const updated: LevelLeaderboardEntry = {
      ...current,
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: Math.max(current.updatedAt, profile.updatedAt),
    };
    await this.collection.doc(playerId).set(toDocument(updated));
  }

  async list(query: LevelLeaderboardListQuery): Promise<readonly RankedLevelLeaderboardEntry[]> {
    if (query.limit <= 0) return [];
    // 精确 ID 只有一条候选，不必下载此前的全部玩家；第二页必定为空。
    if (query.playerId) {
      if (query.offset > 0) return [];
      const entry = await this.findByPlayerId(query.playerId);
      if (!entry || (query.platform && entry.platform !== query.platform)
        || (query.nickName && !entry.nickName.toLocaleLowerCase().includes(query.nickName.toLocaleLowerCase()))) return [];
      return this.withGlobalRanks([entry]);
    }

    const filters: Record<string, unknown> = {};
    if (query.platform) filters.platform = query.platform;
    if (query.nickName) {
      filters.nickName = this.database.RegExp({ regexp: escapeRegExp(query.nickName), options: "i" });
    }
    const result = await this.collection.where(filters)
      .orderBy("sortKey", "asc").skip(query.offset).limit(query.limit).get();
    const entries = result.data.flatMap(value => {
      const entry = toEntry(value);
      return entry ? [entry] : [];
    });
    if (!query.platform && !query.nickName) {
      return entries.map((entry, index) => ({ entry, rank: query.offset + index + 1 }));
    }
    return this.withGlobalRanks(entries);
  }

  /** 一次分桶聚合统计整页的排序区间，避免逐用户查询名次。 */
  private async withGlobalRanks(entries: readonly LevelLeaderboardEntry[]): Promise<readonly RankedLevelLeaderboardEntry[]> {
    if (entries.length === 0) return [];
    const keys = entries.map(createSortKey);
    if (entries.length === 1) {
      const result = await this.collection.where({ sortKey: this.database.command.lt(keys[0]!) }).count();
      if (!Number.isSafeInteger(result.total) || result.total < 0) throw new Error("排行榜名次计数响应无效");
      return [{ entry: entries[0]!, rank: result.total + 1 }];
    }
    const result = await this.collection.aggregate()
      .match({ sortKey: { $lt: keys[keys.length - 1]! } })
      .bucket({
        groupBy: "$sortKey", boundaries: ["", ...keys], output: { count: { $sum: 1 } },
      }).end();
    const allowed = new Set(["", ...keys.slice(0, -1)]);
    const counts = new Map<string, number>();
    for (const value of result.data) {
      const bucket = value as { _id?: unknown; count?: unknown };
      if (typeof bucket?._id !== "string" || !allowed.has(bucket._id) || counts.has(bucket._id)
        || typeof bucket.count !== "number" || !Number.isSafeInteger(bucket.count) || bucket.count < 0) {
        throw new Error("排行榜名次聚合响应无效");
      }
      counts.set(bucket._id, bucket.count);
    }
    // 每桶包含下界、不包含上界：除首桶外，桶内已包括前一个候选玩家。
    let rank = 1;
    return entries.map((entry, index) => {
      rank += counts.get(index === 0 ? "" : keys[index - 1]!) ?? 0;
      return { entry, rank };
    });
  }
}

function toEntry(value: unknown): LevelLeaderboardEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.playerId !== "string"
    || (record.platform !== "wechat" && record.platform !== "bytedance")
    || !Number.isSafeInteger(record.level) || (record.level as number) < 1
    || typeof record.nickName !== "string" || typeof record.avatarUrl !== "string"
    || !Number.isSafeInteger(record.reachedAt) || !Number.isSafeInteger(record.scoreUpdatedAt)
    || !Number.isSafeInteger(record.updatedAt)) return undefined;
  return {
    playerId: record.playerId,
    platform: record.platform,
    level: record.level as number,
    nickName: record.nickName,
    avatarUrl: record.avatarUrl,
    reachedAt: record.reachedAt as number,
    scoreUpdatedAt: record.scoreUpdatedAt as number,
    updatedAt: record.updatedAt as number,
  };
}

function toDocument(entry: LevelLeaderboardEntry): LevelLeaderboardDocument {
  return { ...entry, sortKey: createSortKey(entry) };
}

function createSortKey(entry: LevelLeaderboardEntry): string {
  const inverseLevel = String(1_000_000 - entry.level).padStart(7, "0");
  const reachedAt = String(entry.reachedAt).padStart(16, "0");
  return `${inverseLevel}:${reachedAt}:${entry.playerId}`;
}

/** 关键字始终按字面包含匹配，不把用户输入作为正则表达式执行。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
