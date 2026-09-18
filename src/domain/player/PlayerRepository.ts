import type { PlatformKind } from "../../config/AppConfig.js";
import type { Player } from "./Player.js";

export interface PlatformIdentity {
  readonly platform: PlatformKind;
  readonly appId: string;
  readonly openId: string;
  readonly unionId?: string;
}

export interface PlayerRepository {
  findByPlatformIdentity(identity: PlatformIdentity): Promise<Player | undefined>;
  findById(playerId: string): Promise<Player | undefined>;
  list(query: PlayerListQuery): Promise<readonly Player[]>;
  /** 返回数据库中的规范玩家，解决同一身份并发首次登录时的唯一键竞争。 */
  save(player: Player): Promise<Player>;
}

export interface PlayerListQuery {
  readonly platform?: PlatformKind;
  readonly status?: Player["status"];
  readonly offset: number;
  readonly limit: number;
}
