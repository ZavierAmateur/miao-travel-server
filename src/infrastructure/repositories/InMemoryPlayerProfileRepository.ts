import type { PlayerProfile } from "../../domain/profile/PlayerProfile.js";
import type { PlayerProfileRepository } from "../../domain/profile/PlayerProfileRepository.js";

export class InMemoryPlayerProfileRepository implements PlayerProfileRepository {
  private readonly profiles = new Map<string, PlayerProfile>();

  findByPlayerId(playerId: string): Promise<PlayerProfile | undefined> {
    return Promise.resolve(this.profiles.get(playerId));
  }

  save(profile: PlayerProfile): Promise<PlayerProfile> {
    this.profiles.set(profile.playerId, profile);
    return Promise.resolve(profile);
  }
}
