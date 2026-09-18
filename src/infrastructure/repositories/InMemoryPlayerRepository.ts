import type { PlayerAdminState, PlayerListQuery, PlayerRepository, PlatformIdentity } from "../../domain/player/PlayerRepository.js";
import type { Player } from "../../domain/player/Player.js";

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly players = new Map<string, Player>();

  findByPlatformIdentity(identity: PlatformIdentity): Promise<Player | undefined> {
    return Promise.resolve(this.players.get(this.identityKey(identity)));
  }

  findById(playerId: string): Promise<Player | undefined> {
    return Promise.resolve([...this.players.values()].find((player) => player.id === playerId));
  }

  list(query: PlayerListQuery): Promise<readonly Player[]> {
    const players = [...this.players.values()]
      .filter((player) => !query.platform || player.platform === query.platform)
      .filter((player) => !query.status || player.status === query.status)
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
    return Promise.resolve(players.slice(query.offset, query.offset + query.limit));
  }

  updateAdminState(playerId: string, state: PlayerAdminState): Promise<Player | undefined> {
    const entry = [...this.players.entries()].find(([, player]) => player.id === playerId);
    if (!entry) return Promise.resolve(undefined);
    const [key, player] = entry;
    const updated: Player = {
      ...player,
      status: state.status,
      ...(state.banReason ? { banReason: state.banReason } : {}),
      ...(state.banExpiresAt !== undefined ? { banExpiresAt: state.banExpiresAt } : {}),
      ...(state.bannedAt !== undefined ? { bannedAt: state.bannedAt } : {}),
      ...(state.bannedBy ? { bannedBy: state.bannedBy } : {}),
    };
    this.players.set(key, updated);
    return Promise.resolve(updated);
  }

  save(player: Player): Promise<Player> {
    this.players.set(this.identityKey({
      platform: player.platform,
      appId: player.appId,
      openId: player.platformOpenId,
    }), player);
    return Promise.resolve(player);
  }

  private identityKey(identity: PlatformIdentity): string {
    return `${identity.platform}:${identity.appId}:${identity.openId}`;
  }
}
