import type { LevelLeaderboardEntry, LevelLeaderboardListQuery, RankedLevelLeaderboardEntry, UpsertLevelScoreCommand } from "../../domain/leaderboard/LevelLeaderboard.js";
import type { LevelLeaderboardRepository } from "../../domain/leaderboard/LevelLeaderboardRepository.js";

export class InMemoryLevelLeaderboardRepository implements LevelLeaderboardRepository {
  private readonly entries = new Map<string, LevelLeaderboardEntry>();

  findByPlayerId(playerId: string): Promise<LevelLeaderboardEntry | undefined> {
    return Promise.resolve(this.entries.get(playerId));
  }

  upsertScore(command: UpsertLevelScoreCommand): Promise<LevelLeaderboardEntry> {
    const current = this.entries.get(command.playerId);
    if (current && current.scoreUpdatedAt > command.updatedAt) return Promise.resolve(current);
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
    this.entries.set(command.playerId, entry);
    return Promise.resolve(entry);
  }

  updateProfile(playerId: string, profile: { readonly nickName: string; readonly avatarUrl: string; readonly updatedAt: number }): Promise<void> {
    const current = this.entries.get(playerId);
    if (current) {
      this.entries.set(playerId, {
        ...current,
        nickName: profile.nickName,
        avatarUrl: profile.avatarUrl,
        updatedAt: Math.max(current.updatedAt, profile.updatedAt),
      });
    }
    return Promise.resolve();
  }

  list(query: LevelLeaderboardListQuery): Promise<readonly RankedLevelLeaderboardEntry[]> {
    const sorted = [...this.entries.values()].sort((left, right) =>
      right.level - left.level
      || left.reachedAt - right.reachedAt
      || left.playerId.localeCompare(right.playerId));
    const normalizedNickname = query.nickName?.toLocaleLowerCase();
    const filtered = sorted
      .map((entry, index) => ({ entry, rank: index + 1 }))
      .filter(({ entry }) => (!query.playerId || entry.playerId === query.playerId)
        && (!query.platform || entry.platform === query.platform)
        && (!normalizedNickname || entry.nickName.toLocaleLowerCase().includes(normalizedNickname)));
    return Promise.resolve(filtered.slice(query.offset, query.offset + query.limit));
  }
}
