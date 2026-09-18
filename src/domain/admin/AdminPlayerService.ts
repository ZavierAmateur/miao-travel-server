import { AdminPermission } from "./AdminAccess.js";
import type { AdminAuthService } from "./AdminAuthService.js";
import { AdminPlayerError } from "./AdminPlayerErrors.js";
import type { PlatformKind } from "../../config/AppConfig.js";
import type { PlayerStatus } from "../player/Player.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import type { PlayerProfileRepository } from "../profile/PlayerProfileRepository.js";
import type { CloudSaveRepository } from "../save/CloudSaveRepository.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface AdminPlayerServiceOptions {
  readonly auth: AdminAuthService;
  readonly players: PlayerRepository;
  readonly profiles: PlayerProfileRepository;
  readonly saves: CloudSaveRepository;
}

export class AdminPlayerService {
  constructor(private readonly options: AdminPlayerServiceOptions) {}

  async list(token: string | undefined, query: {
    readonly playerId?: string;
    readonly platform?: PlatformKind;
    readonly status?: PlayerStatus;
    readonly cursor?: string;
    readonly limit?: number;
  }) {
    await this.requireRead(token);
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const offset = decodeCursor(query.cursor);
    if (query.playerId) {
      const player = await this.options.players.findById(query.playerId);
      return { items: player ? [await this.toListItem(player)] : [], nextCursor: null };
    }
    const players = await this.options.players.list({
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.status ? { status: query.status } : {}),
      offset,
      limit: limit + 1,
    });
    const hasNext = players.length > limit;
    const visible = players.slice(0, limit);
    return {
      items: await Promise.all(visible.map((player) => this.toListItem(player))),
      nextCursor: hasNext ? encodeCursor(offset + limit) : null,
    };
  }

  async get(token: string | undefined, playerId: string) {
    await this.requireRead(token);
    const player = await this.options.players.findById(playerId);
    if (!player) throw new AdminPlayerError("PLAYER_NOT_FOUND", "玩家不存在", 404);
    const [profile, save] = await Promise.all([
      this.options.profiles.findByPlayerId(player.id),
      this.options.saves.findByPlayerId(player.id),
    ]);
    return {
      id: player.id,
      platform: player.platform,
      appId: player.appId,
      status: player.status,
      createdAt: player.createdAt,
      lastLoginAt: player.lastLoginAt,
      profile: profile ? {
        nickName: profile.nickName,
        avatarUrl: profile.avatarUrl,
        updatedAt: profile.updatedAt,
      } : null,
      save: save ? toSaveSummary(save) : null,
    };
  }

  private async requireRead(token?: string): Promise<void> {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(AdminPermission.PlayerRead)) {
      throw new AdminPlayerError("ADMIN_PERMISSION_DENIED", "无权查看玩家信息", 403);
    }
  }

  private async toListItem(player: Awaited<ReturnType<PlayerRepository["findById"]>> & {}) {
    const save = await this.options.saves.findByPlayerId(player.id);
    return {
      id: player.id,
      platform: player.platform,
      status: player.status,
      createdAt: player.createdAt,
      lastLoginAt: player.lastLoginAt,
      save: save ? toSaveSummary(save) : null,
    };
  }
}

function toSaveSummary(save: Awaited<ReturnType<CloudSaveRepository["findByPlayerId"]>> & {}) {
  return {
    revision: save.revision,
    clientVersion: save.clientVersion,
    clientSavedAt: save.clientSavedAt,
    serverSavedAt: save.serverSavedAt,
    sizeBytes: save.sizeBytes,
  };
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error("invalid");
    return Number(parsed.offset);
  } catch {
    throw new AdminPlayerError("INVALID_CURSOR", "分页游标无效", 400);
  }
}
