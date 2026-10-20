import type { PlayerProfile } from "../../domain/profile/PlayerProfile.js";
import type { PlayerProfileRepository } from "../../domain/profile/PlayerProfileRepository.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

type PlayerProfileDocument = Omit<PlayerProfile, "playerId">;

export class CloudBasePlayerProfileRepository implements PlayerProfileRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

  async findByPlayerId(playerId: string): Promise<PlayerProfile | undefined> {
    try {
      const result = await this.collection.doc(playerId).get();
      const document = result.data[0] as PlayerProfileDocument | undefined;
      return document ? { playerId, ...document } : undefined;
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }

  async listPendingLeaderboardSync(limit: number, offset: number): Promise<readonly PlayerProfile[]> {
    const result = await this.collection.where({ leaderboardSyncPending: true })
      .orderBy("_id", "asc").skip(offset).limit(limit).get();
    return result.data.flatMap(value => {
      const document = value as PlayerProfileDocument & { _id?: unknown };
      return typeof document?._id === "string" ? [{
        playerId: document._id, nickName: document.nickName, avatarUrl: document.avatarUrl,
        updatedAt: document.updatedAt, leaderboardSyncPending: true,
      }] : [];
    });
  }

  async markLeaderboardSynced(profile: PlayerProfile): Promise<boolean> {
    const result = await this.collection.where({
      _id: profile.playerId, updatedAt: profile.updatedAt,
      nickName: profile.nickName, avatarUrl: profile.avatarUrl, leaderboardSyncPending: true,
    }).update({ leaderboardSyncPending: false });
    return result.updated === 1;
  }

  async save(profile: PlayerProfile): Promise<PlayerProfile> {
    await this.collection.doc(profile.playerId).set({
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: profile.updatedAt,
      leaderboardSyncPending: true,
    });
    return { ...profile, leaderboardSyncPending: true };
  }
}
