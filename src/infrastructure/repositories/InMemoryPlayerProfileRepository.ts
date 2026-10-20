import type { PlayerProfile } from "../../domain/profile/PlayerProfile.js";
import type { PlayerProfileRepository } from "../../domain/profile/PlayerProfileRepository.js";

export class InMemoryPlayerProfileRepository implements PlayerProfileRepository {
  private readonly profiles = new Map<string, PlayerProfile>();

  findByPlayerId(playerId: string): Promise<PlayerProfile | undefined> {
    return Promise.resolve(this.profiles.get(playerId));
  }

  listPendingLeaderboardSync(limit: number, offset: number): Promise<readonly PlayerProfile[]> {
    return Promise.resolve([...this.profiles.values()]
      .filter(profile => profile.leaderboardSyncPending)
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
      .slice(offset, offset + limit));
  }

  markLeaderboardSynced(profile: PlayerProfile): Promise<boolean> {
    const current = this.profiles.get(profile.playerId);
    if (!current?.leaderboardSyncPending || current.updatedAt !== profile.updatedAt
      || current.nickName !== profile.nickName || current.avatarUrl !== profile.avatarUrl) return Promise.resolve(false);
    this.profiles.set(profile.playerId, { ...current, leaderboardSyncPending: false });
    return Promise.resolve(true);
  }

  save(profile: PlayerProfile): Promise<PlayerProfile> {
    const record = { ...profile, leaderboardSyncPending: true };
    this.profiles.set(profile.playerId, record);
    return Promise.resolve(record);
  }
}
