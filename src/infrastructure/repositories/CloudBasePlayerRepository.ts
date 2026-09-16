import { createHash } from "node:crypto";
import type { PlatformKind } from "../../config/AppConfig.js";
import type { Player, PlayerStatus } from "../../domain/player/Player.js";
import type { PlatformIdentity, PlayerRepository } from "../../domain/player/PlayerRepository.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { hashOptionalIdentifier, hashPlatformIdentity } from "../persistence/IdentityHash.js";

export interface CloudBasePlayerDocument {
  readonly _id?: string;
  readonly id: string;
  readonly platform: PlatformKind;
  readonly appId: string;
  readonly unionIdHash?: string;
  readonly status: PlayerStatus;
  readonly createdAt: number;
  readonly lastLoginAt: number;
}

export class CloudBasePlayerRepository implements PlayerRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

  async findByPlatformIdentity(identity: PlatformIdentity): Promise<Player | undefined> {
    const result = await this.collection.doc(hashPlatformIdentity(identity)).get();
    const document = result.data[0] as CloudBasePlayerDocument | undefined;
    return document ? this.toPlayer(document, identity.openId, identity.unionId) : undefined;
  }

  async save(player: Player): Promise<Player> {
    const identity: PlatformIdentity = {
      platform: player.platform,
      appId: player.appId,
      openId: player.platformOpenId,
    };
    const identityHash = hashPlatformIdentity(identity);
    const reference = this.collection.doc(identityHash);
    const unionIdHash = hashOptionalIdentifier(player.unionId);
    const document: CloudBasePlayerDocument = {
      id: playerIdFromIdentityHash(identityHash),
      platform: player.platform,
      appId: player.appId,
      ...(unionIdHash ? { unionIdHash } : {}),
      status: player.status,
      createdAt: player.createdAt,
      lastLoginAt: player.lastLoginAt,
    };
    await reference.set(document);
    return this.toPlayer(document, player.platformOpenId, player.unionId);
  }

  private toPlayer(document: CloudBasePlayerDocument, openId: string, unionId?: string): Player {
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

function playerIdFromIdentityHash(identityHash: string): string {
  const hex = createHash("sha256").update(`miao-player:${identityHash}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
