import type { CloudSavePayload } from "../save/CloudSave.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import type { PlayerProfile, PutPlayerProfileInput } from "../profile/PlayerProfile.js";
import type { PlayerProfileRepository } from "../profile/PlayerProfileRepository.js";
import type { LevelLeaderboardRepository } from "./LevelLeaderboardRepository.js";

export const MAX_LEADERBOARD_LEVEL = 1_000_000;

export interface LevelLeaderboardProjectorOptions {
  readonly leaderboard: LevelLeaderboardRepository;
  readonly players: PlayerRepository;
  readonly profiles: PlayerProfileRepository;
}

/** 把云存档和独立微信资料投影成适合排序查询的小文档。 */
export class LevelLeaderboardProjector {
  constructor(private readonly options: LevelLeaderboardProjectorOptions) {}

  async syncSave(playerId: string, save: CloudSavePayload, serverSavedAt: number): Promise<void> {
    const level = readLevel(save);
    if (level === undefined) return;
    const [player, profile] = await Promise.all([
      this.options.players.findById(playerId),
      this.options.profiles.findByPlayerId(playerId),
    ]);
    if (!player) return;
    await this.options.leaderboard.upsertScore({
      playerId,
      platform: player.platform,
      level,
      nickName: profile?.nickName ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
      updatedAt: serverSavedAt,
    });
  }

  async syncProfile(profile: PlayerProfile | (PutPlayerProfileInput & { readonly playerId: string; readonly updatedAt: number })): Promise<void> {
    await this.options.leaderboard.updateProfile(profile.playerId, {
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: profile.updatedAt,
    });
  }
}

export function readLevel(save: CloudSavePayload): number | undefined {
  const user = save.modules.user;
  if (typeof user !== "object" || user === null || Array.isArray(user)) return undefined;
  const level = user.level;
  return Number.isSafeInteger(level) && (level as number) >= 1 && (level as number) <= MAX_LEADERBOARD_LEVEL
    ? level as number
    : undefined;
}
