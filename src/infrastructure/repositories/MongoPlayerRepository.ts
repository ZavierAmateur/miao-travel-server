import type { Collection } from "mongodb";
import type { PlatformKind } from "../../config/AppConfig.js";
import type { Player, PlayerStatus } from "../../domain/player/Player.js";
import type { PlatformIdentity, PlayerRepository } from "../../domain/player/PlayerRepository.js";
import { hashOptionalIdentifier, hashPlatformIdentity } from "../persistence/IdentityHash.js";

export interface MongoPlayerDocument {
  readonly _id: string;
  readonly id: string;
  readonly platform: PlatformKind;
  readonly appId: string;
  readonly unionIdHash?: string;
  readonly status: PlayerStatus;
  readonly createdAt: number;
  readonly lastLoginAt: number;
}

export class MongoPlayerRepository implements PlayerRepository {
  constructor(private readonly collection: Collection<MongoPlayerDocument>) {}

  async findByPlatformIdentity(identity: PlatformIdentity): Promise<Player | undefined> {
    const document = await this.collection.findOne({ _id: hashPlatformIdentity(identity) });
    return document ? this.toPlayer(document, identity.openId) : undefined;
  }

  async save(player: Player): Promise<Player> {
    const identity: PlatformIdentity = {
      platform: player.platform,
      appId: player.appId,
      openId: player.platformOpenId,
    };
    const unionIdHash = hashOptionalIdentifier(player.unionId);
    const document = await this.collection.findOneAndUpdate(
      { _id: hashPlatformIdentity(identity) },
      {
        $setOnInsert: {
          id: player.id,
          platform: player.platform,
          appId: player.appId,
          createdAt: player.createdAt,
        },
        $set: {
          status: player.status,
          lastLoginAt: player.lastLoginAt,
          ...(unionIdHash ? { unionIdHash } : {}),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!document) throw new Error("玩家写入后未能读取规范记录");
    return this.toPlayer(document, player.platformOpenId, player.unionId);
  }

  private toPlayer(document: MongoPlayerDocument, openId: string, unionId?: string): Player {
    return {
      id: document.id,
      platform: document.platform,
      appId: document.appId,
      platformOpenId: openId,
      ...(unionId ? { unionId } : {}),
      status: document.status,
      createdAt: document.createdAt,
      lastLoginAt: document.lastLoginAt,
    };
  }
}
