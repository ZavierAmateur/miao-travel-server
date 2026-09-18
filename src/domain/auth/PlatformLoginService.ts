import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/AppConfig.js";
import { isPlayerBanActive, PlayerStatus, type Player } from "../player/Player.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import type { SessionRepository } from "../session/SessionRepository.js";
import type { PlatformAuthGateway, PlatformLoginCode } from "../../platform/PlatformAuthGateway.js";

export interface PlatformLoginResult {
  readonly token: string;
  readonly playerId: string;
  readonly isNew: boolean;
  readonly isBanned: boolean;
  readonly banReason: string;
  readonly banExpire: number;
  readonly whiteList: boolean;
  readonly data: string;
  readonly saveRevision: number;
  readonly serverTime: number;
}

export interface PlatformLoginServiceOptions {
  readonly config: AppConfig;
  readonly gateway: PlatformAuthGateway;
  readonly players: PlayerRepository;
  readonly sessions: SessionRepository;
  readonly now?: () => number;
  readonly createPlayerId?: () => string;
  readonly createToken?: () => string;
  readonly sessionLifetimeMs?: number;
}

export class PlatformLoginService {
  private readonly now: () => number;
  private readonly createPlayerId: () => string;
  private readonly createToken: () => string;
  private readonly sessionLifetimeMs: number;

  constructor(private readonly options: PlatformLoginServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createPlayerId = options.createPlayerId ?? randomUUID;
    this.createToken = options.createToken ?? (() => randomBytes(32).toString("base64url"));
    this.sessionLifetimeMs = options.sessionLifetimeMs ?? 30 * 24 * 60 * 60 * 1_000;
  }

  async login(loginCode: PlatformLoginCode): Promise<PlatformLoginResult> {
    const identity = await this.options.gateway.exchangeCode(loginCode);
    if (identity.platform !== this.options.config.platform) {
      throw new Error("平台认证结果与当前部署不一致");
    }

    const now = this.now();
    const existing = await this.options.players.findByPlatformIdentity({
      platform: identity.platform,
      appId: this.options.config.appId,
      openId: identity.openId,
    });
    const activeBan = existing ? isPlayerBanActive(existing, now) : false;
    const player: Player = existing
      ? activeBan
        ? { ...existing, lastLoginAt: now }
        : withoutBan({ ...existing, status: PlayerStatus.Active, lastLoginAt: now })
      : {
          id: this.createPlayerId(),
          platform: identity.platform,
          appId: this.options.config.appId,
          platformOpenId: identity.openId,
          ...(identity.unionId ? { unionId: identity.unionId } : {}),
          status: PlayerStatus.Active,
          createdAt: now,
          lastLoginAt: now,
        };
    const storedPlayer = await this.options.players.save(player);

    const token = this.createToken();
    await this.options.sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: storedPlayer.id,
      createdAt: now,
      expiresAt: now + this.sessionLifetimeMs,
    });

    return {
      token,
      playerId: storedPlayer.id,
      isNew: !existing,
      isBanned: isPlayerBanActive(storedPlayer, now),
      banReason: isPlayerBanActive(storedPlayer, now) ? storedPlayer.banReason ?? "" : "",
      banExpire: isPlayerBanActive(storedPlayer, now) ? storedPlayer.banExpiresAt ?? 0 : 0,
      whiteList: false,
      data: "",
      saveRevision: 0,
      serverTime: now,
    };
  }
}

function withoutBan(player: Player): Player {
  return {
    id: player.id,
    platform: player.platform,
    appId: player.appId,
    platformOpenId: player.platformOpenId,
    ...(player.unionId ? { unionId: player.unionId } : {}),
    status: PlayerStatus.Active,
    createdAt: player.createdAt,
    lastLoginAt: player.lastLoginAt,
  };
}
