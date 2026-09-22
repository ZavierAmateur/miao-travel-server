import { randomUUID } from "node:crypto";
import { AdminPermission, AdminRole } from "./AdminAccess.js";
import type { AdminAuthService } from "./AdminAuthService.js";
import { AdminPlayerError } from "./AdminPlayerErrors.js";
import type { PlatformKind } from "../../config/AppConfig.js";
import type { PlayerStatus } from "../player/Player.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import type { PlayerProfileRepository } from "../profile/PlayerProfileRepository.js";
import type { CloudSaveRepository } from "../save/CloudSaveRepository.js";
import type { AdminAuditRepository } from "./AdminRepositories.js";
import type { AdminIdentity } from "./AdminAuthService.js";
import type { CloudSaveRecord, CloudSaveSnapshot, JsonValue } from "../save/CloudSave.js";
import type { LevelLeaderboardProjector } from "../leaderboard/LevelLeaderboardProjector.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface AdminPlayerServiceOptions {
  readonly auth: AdminAuthService;
  readonly players: PlayerRepository;
  readonly profiles: PlayerProfileRepository;
  readonly saves: CloudSaveRepository;
  readonly audits: AdminAuditRepository;
  readonly leaderboard?: LevelLeaderboardProjector;
  readonly now?: () => number;
}

export class AdminPlayerService {
  private readonly now: () => number;

  constructor(private readonly options: AdminPlayerServiceOptions) {
    this.now = options.now ?? Date.now;
  }

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
      ban: player.status === "banned" ? {
        reason: player.banReason ?? "",
        expiresAt: player.banExpiresAt ?? 0,
        bannedAt: player.bannedAt ?? 0,
        permanent: !player.banExpiresAt,
      } : null,
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

  async getSaveDiagnostics(token: string | undefined, playerId: string) {
    await this.requirePermission(token, AdminPermission.SaveRead, "无权查看云存档");
    if (!await this.options.players.findById(playerId)) {
      throw new AdminPlayerError("PLAYER_NOT_FOUND", "玩家不存在", 404);
    }
    const save = await this.options.saves.findByPlayerId(playerId);
    if (!save) throw new AdminPlayerError("SAVE_NOT_FOUND", "玩家暂无云存档", 404);
    return {
      current: toVersionSummary(save),
      previous: save.previous ? toVersionSummary(save.previous) : null,
      changes: save.previous ? diffUser(save.previous, save) : [],
    };
  }

  async rollbackSave(token: string | undefined, playerId: string, input: {
    readonly expectedRevision: number;
    readonly reason: string;
  }, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.SaveRollback, "无权回滚云存档");
    const reason = validateReason(input.reason);
    const auditKey = randomUUID();
    const result = await this.options.saves.rollbackPrevious({
      playerId,
      expectedRevision: input.expectedRevision,
      serverSavedAt: this.now(),
      auditKey,
    });
    if (result.status === "conflict") {
      throw new AdminPlayerError("SAVE_ROLLBACK_CONFLICT", "云存档版本已变化，请刷新后重试", 409);
    }
    if (result.status === "no_previous") {
      throw new AdminPlayerError("SAVE_PREVIOUS_NOT_FOUND", "没有可回滚的上一版本", 409);
    }
    await this.options.leaderboard?.syncSave(playerId, result.record.save, result.record.serverSavedAt);
    await this.options.audits.append({
      id: auditKey,
      adminUserId: identity.id,
      action: "save.rollback",
      requestId: context.requestId,
      ip: context.ip,
      createdAt: this.now(),
      targetPlayerId: playerId,
      reason,
      metadata: {
        expectedRevision: input.expectedRevision,
        sourceRevision: result.sourceRevision,
        newRevision: result.record.revision,
      },
    });
    return { sourceRevision: result.sourceRevision, revision: result.record.revision, serverSavedAt: result.record.serverSavedAt };
  }

  async ban(token: string | undefined, playerId: string, input: {
    readonly type: "temporary" | "permanent";
    readonly expiresAt?: number;
    readonly reason: string;
    readonly note?: string;
  }, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.PlayerBan, "无权封禁玩家");
    if (input.type === "permanent" && identity.role !== AdminRole.Admin) {
      throw new AdminPlayerError("ADMIN_PERMISSION_DENIED", "只有超级管理员可以永久封禁", 403);
    }
    const reason = validateReason(input.reason);
    const note = validateNote(input.note);
    const expiresAt = input.type === "temporary" ? validateExpiry(input.expiresAt, this.now()) : 0;
    const updated = await this.options.players.updateAdminState(playerId, {
      status: "banned",
      banReason: reason,
      banExpiresAt: expiresAt,
      bannedAt: this.now(),
      bannedBy: identity.id,
    });
    if (!updated) throw new AdminPlayerError("PLAYER_NOT_FOUND", "玩家不存在", 404);
    const auditId = randomUUID();
    await this.options.audits.append({
      id: auditId,
      adminUserId: identity.id,
      action: "player.ban",
      requestId: context.requestId,
      ip: context.ip,
      createdAt: this.now(),
      targetPlayerId: playerId,
      reason,
      metadata: { type: input.type, expiresAt, ...(note ? { note } : {}) },
    });
    return { status: updated.status, reason, expiresAt, permanent: input.type === "permanent" };
  }

  async unban(token: string | undefined, playerId: string, input: { readonly reason: string }, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.PlayerBan, "无权解封玩家");
    const reason = validateReason(input.reason);
    const updated = await this.options.players.updateAdminState(playerId, { status: "active" });
    if (!updated) throw new AdminPlayerError("PLAYER_NOT_FOUND", "玩家不存在", 404);
    await this.options.audits.append({
      id: randomUUID(),
      adminUserId: identity.id,
      action: "player.unban",
      requestId: context.requestId,
      ip: context.ip,
      createdAt: this.now(),
      targetPlayerId: playerId,
      reason,
    });
    return { status: updated.status };
  }

  private async requireRead(token?: string): Promise<void> {
    await this.requirePermission(token, AdminPermission.PlayerRead, "无权查看玩家信息");
  }

  private async requirePermission(token: string | undefined, permission: AdminPermission, message: string): Promise<AdminIdentity> {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(permission)) throw new AdminPlayerError("ADMIN_PERMISSION_DENIED", message, 403);
    return identity;
  }

  private async toListItem(player: Awaited<ReturnType<PlayerRepository["findById"]>> & {}) {
    const [profile, save] = await Promise.all([
      this.options.profiles.findByPlayerId(player.id),
      this.options.saves.findByPlayerId(player.id),
    ]);
    return {
      id: player.id,
      platform: player.platform,
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
}

function toVersionSummary(save: CloudSaveRecord | CloudSaveSnapshot) {
  const user = asRecord(save.save.modules.user);
  return {
    revision: save.revision,
    clientVersion: save.clientVersion,
    clientSavedAt: save.clientSavedAt,
    serverSavedAt: save.serverSavedAt,
    hash: save.hash,
    sizeBytes: save.sizeBytes,
    user,
  };
}

function diffUser(previous: CloudSaveSnapshot, current: CloudSaveRecord) {
  const before = asRecord(previous.save.modules.user);
  const after = asRecord(current.save.modules.user);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, previous: before[field] ?? null, current: after[field] ?? null }));
}

function asRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function validateReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 200) {
    throw new AdminPlayerError("INVALID_ADMIN_ACTION", "操作原因长度必须为 2-200 个字符", 400);
  }
  return reason;
}

function validateNote(value?: string): string {
  const note = value?.trim() ?? "";
  if (note.length > 500) throw new AdminPlayerError("INVALID_ADMIN_ACTION", "内部备注不能超过 500 个字符", 400);
  return note;
}

function validateExpiry(value: number | undefined, now: number): number {
  if (!Number.isSafeInteger(value) || Number(value) <= now) {
    throw new AdminPlayerError("INVALID_ADMIN_ACTION", "临时封禁到期时间必须晚于当前时间", 400);
  }
  return Number(value);
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
