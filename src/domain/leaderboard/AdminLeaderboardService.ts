import { AdminPermission } from "../admin/AdminAccess.js";
import type { AdminAuthService } from "../admin/AdminAuthService.js";
import { AdminPlayerError } from "../admin/AdminPlayerErrors.js";
import type { LevelLeaderboardRepository } from "./LevelLeaderboardRepository.js";

export const ADMIN_LEADERBOARD_PAGE_SIZE = 20;
const MAX_PAGE = 10_000;

export class AdminLeaderboardService {
  constructor(private readonly options: {
    readonly auth: AdminAuthService;
    readonly leaderboard: LevelLeaderboardRepository;
  }) {}

  async listLevel(token: string | undefined, query: { readonly page?: number }) {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(AdminPermission.PlayerRead)) {
      throw new AdminPlayerError("ADMIN_PERMISSION_DENIED", "无权查看排行榜", 403);
    }
    const page = query.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
      throw new AdminPlayerError("INVALID_LEADERBOARD_PAGE", "排行榜页码无效", 400);
    }
    const offset = (page - 1) * ADMIN_LEADERBOARD_PAGE_SIZE;
    const records = await this.options.leaderboard.list({
      offset,
      limit: ADMIN_LEADERBOARD_PAGE_SIZE + 1,
    });
    const hasMore = records.length > ADMIN_LEADERBOARD_PAGE_SIZE;
    return {
      items: records.slice(0, ADMIN_LEADERBOARD_PAGE_SIZE).map((entry, index) => ({
        rank: offset + index + 1,
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
