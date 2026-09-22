import type { LevelLeaderboardEntry, LevelLeaderboardListQuery, UpsertLevelScoreCommand } from "../../domain/leaderboard/LevelLeaderboard.js";
import type { LevelLeaderboardRepository } from "../../domain/leaderboard/LevelLeaderboardRepository.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

interface LevelLeaderboardDocument extends LevelLeaderboardEntry {
  readonly sortKey: string;
}

export class CloudBaseLevelLeaderboardRepository implements LevelLeaderboardRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

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

  async list(query: LevelLeaderboardListQuery): Promise<readonly LevelLeaderboardEntry[]> {
    const result = await this.collection.where({})
      .orderBy("sortKey", "asc")
      .skip(query.offset)
      .limit(query.limit)
      .get();
    return result.data.flatMap((value) => {
      const entry = toEntry(value);
      return entry ? [entry] : [];
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
