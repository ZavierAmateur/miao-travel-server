import type { PlayerProfile } from "./PlayerProfile.js";

export interface PlayerProfileRepository {
  findByPlayerId(playerId: string): Promise<PlayerProfile | undefined>;
  save(profile: PlayerProfile): Promise<PlayerProfile>;
  listPendingLeaderboardSync(limit: number, offset: number): Promise<readonly PlayerProfile[]>;
  markLeaderboardSynced(profile: PlayerProfile): Promise<boolean>;
}
