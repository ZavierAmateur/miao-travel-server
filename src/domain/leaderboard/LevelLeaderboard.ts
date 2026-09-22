import type { PlatformKind } from "../../config/AppConfig.js";

/** 管理后台使用的全平台闯关榜轻量投影。 */
export interface LevelLeaderboardEntry {
  readonly playerId: string;
  readonly platform: PlatformKind;
  readonly level: number;
  readonly nickName: string;
  readonly avatarUrl: string;
  /** 首次达到当前 level 的服务端时间；降级或回滚后重新计算。 */
  readonly reachedAt: number;
  readonly scoreUpdatedAt: number;
  readonly updatedAt: number;
}

export interface UpsertLevelScoreCommand {
  readonly playerId: string;
  readonly platform: PlatformKind;
  readonly level: number;
  readonly nickName: string;
  readonly avatarUrl: string;
  readonly updatedAt: number;
}

export interface LevelLeaderboardListQuery {
  readonly offset: number;
  readonly limit: number;
  readonly playerId?: string;
  readonly platform?: PlatformKind;
  readonly nickName?: string;
}

export interface RankedLevelLeaderboardEntry {
  readonly entry: LevelLeaderboardEntry;
  /** 未筛选全榜中的真实名次。 */
  readonly rank: number;
}
