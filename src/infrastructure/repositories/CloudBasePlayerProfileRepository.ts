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

  async save(profile: PlayerProfile): Promise<PlayerProfile> {
    await this.collection.doc(profile.playerId).set({
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: profile.updatedAt,
    });
    return profile;
  }
}
