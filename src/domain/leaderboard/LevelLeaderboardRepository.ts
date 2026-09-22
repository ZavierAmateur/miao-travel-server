import type {
  LevelLeaderboardEntry,
  LevelLeaderboardListQuery,
  UpsertLevelScoreCommand,
} from "./LevelLeaderboard.js";

export interface LevelLeaderboardRepository {
  findByPlayerId(playerId: string): Promise<LevelLeaderboardEntry | undefined>;
  upsertScore(command: UpsertLevelScoreCommand): Promise<LevelLeaderboardEntry>;
  updateProfile(playerId: string, profile: {
    readonly nickName: string;
    readonly avatarUrl: string;
    readonly updatedAt: number;
  }): Promise<void>;
  list(query: LevelLeaderboardListQuery): Promise<readonly LevelLeaderboardEntry[]>;
}
