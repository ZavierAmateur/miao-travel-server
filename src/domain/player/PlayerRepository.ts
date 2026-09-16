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
  save(player: Player): Promise<void>;
}
