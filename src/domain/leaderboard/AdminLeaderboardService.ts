import { AdminPermission } from "../admin/AdminAccess.js";
import type { AdminAuthService } from "../admin/AdminAuthService.js";
import { AdminPlayerError } from "../admin/AdminPlayerErrors.js";
import type { PlatformKind } from "../../config/AppConfig.js";
import type { LevelLeaderboardRepository } from "./LevelLeaderboardRepository.js";

export const ADMIN_LEADERBOARD_PAGE_SIZE = 20;
const MAX_PAGE = 10_000;

export class AdminLeaderboardService {
  constructor(private readonly options: {
    readonly auth: AdminAuthService;
    readonly leaderboard: LevelLeaderboardRepository;
  }) {}

  async listLevel(token: string | undefined, query: {
    readonly page?: number;
    readonly playerId?: string;
    readonly platform?: PlatformKind;
    readonly nickName?: string;
  }) {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(AdminPermission.PlayerRead)) {
      throw new AdminPlayerError("ADMIN_PERMISSION_DENIED", "无权查看排行榜", 403);
    }
    const page = query.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
      throw new AdminPlayerError("INVALID_LEADERBOARD_PAGE", "排行榜页码无效", 400);
    }
    const playerId = normalizeFilter(query.playerId, 128, "用户 ID");
    const nickName = normalizeFilter(query.nickName, 50, "微信昵称");
    const offset = (page - 1) * ADMIN_LEADERBOARD_PAGE_SIZE;
    const records = await this.options.leaderboard.list({
      offset,
      limit: ADMIN_LEADERBOARD_PAGE_SIZE + 1,
      ...(playerId ? { playerId } : {}),
      ...(query.platform ? { platform: query.platform } : {}),
      ...(nickName ? { nickName } : {}),
    });
    const hasMore = records.length > ADMIN_LEADERBOARD_PAGE_SIZE;
    return {
      items: records.slice(0, ADMIN_LEADERBOARD_PAGE_SIZE).map(({ entry, rank }) => ({
        rank,
        playerId: entry.playerId,
        platform: entry.platform,
        level: entry.level,
        nickName: entry.nickName,
        avatarUrl: entry.avatarUrl,
        reachedAt: entry.reachedAt,
        updatedAt: entry.updatedAt,
      })),
      page,
      pageSize: ADMIN_LEADERBOARD_PAGE_SIZE,
      hasMore,
    } as const;
  }
}

function normalizeFilter(value: string | undefined, maxLength: number, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new AdminPlayerError("INVALID_LEADERBOARD_FILTER", `${label}筛选条件过长`, 400);
  }
  return normalized;
}
