import type { PlayerRepository, PlatformIdentity } from "../../domain/player/PlayerRepository.js";
import type { Player } from "../../domain/player/Player.js";

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<string, Player>();

  findByPlatformIdentity(identity: PlatformIdentity): Promise<Player | undefined> {
    return Promise.resolve(this.players.get(this.identityKey(identity)));
  }

  save(player: Player): Promise<void> {
    this.players.set(this.identityKey({
      platform: player.platform,
      appId: player.appId,
      openId: player.platformOpenId,
    }), player);
    return Promise.resolve();
  }

  private identityKey(identity: PlatformIdentity): string {
    return `${identity.platform}:${identity.appId}:${identity.openId}`;
  }
}
