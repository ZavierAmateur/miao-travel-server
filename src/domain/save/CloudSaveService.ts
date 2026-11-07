import type { SessionRepository } from "../session/SessionRepository.js";
import { authenticateSession } from "../auth/SessionAuthenticator.js";
import type { CloudSaveRepository } from "./CloudSaveRepository.js";
import { CloudSaveConflictError, CloudSaveValidationError } from "./CloudSaveErrors.js";
import { validateCloudSaveInput, type PutCloudSaveInput } from "./CloudSaveValidation.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import { requestLeaderboardSync, type LeaderboardSyncService } from "../leaderboard/LeaderboardSyncService.js";

export interface CloudSaveServiceOptions {
  readonly requiredGeneration?: string;
  readonly requiredProgressVersion?: string;
  readonly firstPlayableLevel?: number;
  readonly sessions: SessionRepository;
  readonly saves: CloudSaveRepository;
  readonly players?: PlayerRepository;
  readonly leaderboardSync?: Pick<LeaderboardSyncService, "requestSync">;
  readonly now?: () => number;
}

export class CloudSaveService {
  private readonly now: () => number;

  constructor(private readonly options: CloudSaveServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get saveGeneration(): string | undefined { return this.options.requiredGeneration; }

  get progressVersion(): string | undefined { return this.options.requiredProgressVersion; }

  async get(authorization?: string) {
    const playerId = await authenticateSession(this.options.sessions, authorization, this.now, this.options.players);
    const record = await this.options.saves.findByPlayerId(playerId);
    const generation = this.saveGeneration ? { generation: this.saveGeneration } : {};
    if (!record || (this.saveGeneration && record.save.generation !== this.saveGeneration)) {
      return { ...generation, exists: false, revision: 0, serverSavedAt: 0, save: null } as const;
    }
    return {
      ...generation,
      exists: true,
      revision: record.revision,
      serverSavedAt: record.serverSavedAt,
      hash: record.hash,
      save: record.save,
    } as const;
  }

  async put(authorization: string | undefined, input: PutCloudSaveInput) {
    const playerId = await authenticateSession(this.options.sessions, authorization, this.now, this.options.players);
    if (this.saveGeneration && (input.save as { generation?: unknown } | null)?.generation !== this.saveGeneration) {
      throw new CloudSaveValidationError("SAVE_GENERATION_MISMATCH", "旧游戏存档已重置，请更新客户端后从新起点开始");
    }
    const validated = validateCloudSaveInput(input);
    const user = validated.save.modules.user as { level?: number; levelProgressVersion?: string };
    if (this.progressVersion && user.levelProgressVersion !== this.progressVersion) {
      throw new CloudSaveValidationError("SAVE_PROGRESS_VERSION_MISMATCH", "关卡已更新，请更新客户端后重置关卡进度，其他资产保留");
    }
    if (this.options.firstPlayableLevel && (!Number.isInteger(user.level) || user.level! < this.options.firstPlayableLevel)) {
      throw new CloudSaveValidationError("INVALID_SAVE", `新关卡进度必须从第${this.options.firstPlayableLevel}关开始`);
    }
    const result = await this.options.saves.compareAndSet({
      playerId,
      ...validated,
      serverSavedAt: this.now(),
    });
    if (result.status === "conflict") {
      const current = result.current;
      throw new CloudSaveConflictError(current ? {
        revision: current.revision,
        serverSavedAt: current.serverSavedAt,
        hash: current.hash,
      } : undefined);
    }
    requestLeaderboardSync(this.options.leaderboardSync);
    return {
      revision: result.record.revision,
      serverSavedAt: result.record.serverSavedAt,
      hash: result.record.hash,
      duplicate: result.status === "duplicate",
    };
  }

}
