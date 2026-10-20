import type { CloudSaveRepository } from "../save/CloudSaveRepository.js";
import type { PlayerProfileRepository } from "../profile/PlayerProfileRepository.js";
import type { LevelLeaderboardProjector } from "./LevelLeaderboardProjector.js";

type Source = "save" | "profile";
export interface LeaderboardSyncFailure {
  readonly source: Source;
  readonly playerId?: string;
  readonly errorName: string;
}

export interface LeaderboardSyncServiceOptions {
  readonly saves: CloudSaveRepository;
  readonly profiles: PlayerProfileRepository;
  readonly projector: LevelLeaderboardProjector;
  readonly onError?: (failure: LeaderboardSyncFailure) => void;
  readonly intervalMs?: number;
  readonly batchSize?: number;
}

/** 待同步标记与主记录一起落盘；请求只唤醒任务，不等待排行榜读写。 */
export class LeaderboardSyncService {
  private readonly batchSize: number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private wakeAgain = false;
  private saveOffset = 0;
  private profileOffset = 0;

  constructor(private readonly options: LeaderboardSyncServiceOptions) {
    this.batchSize = options.batchSize ?? 20;
  }

  start(): void {
    if (this.interval) return;
    this.stopped = false;
    this.interval = setInterval(() => this.requestSync(), this.options.intervalMs ?? 30_000);
    this.interval.unref();
    this.requestSync();
  }

  requestSync(): void {
    if (this.stopped) return;
    if (this.active) { this.wakeAgain = true; return; }
    if (this.scheduled) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      void this.runOnce();
    }, 0);
    this.scheduled.unref();
  }

  runOnce(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopped) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      this.saveOffset = await this.processBatch(
        "save", this.saveOffset,
        () => this.options.saves.listPendingLeaderboardSync(this.batchSize, this.saveOffset),
        record => this.options.projector.syncSave(record.playerId, record.save, record.serverSavedAt),
        record => this.options.saves.markLeaderboardSynced(record.playerId, record.revision),
      );
      if (this.stopped) return;
      this.profileOffset = await this.processBatch(
        "profile", this.profileOffset,
        () => this.options.profiles.listPendingLeaderboardSync(this.batchSize, this.profileOffset),
        profile => this.options.projector.syncProfile(profile),
        profile => this.options.profiles.markLeaderboardSynced(profile),
      );
    }).finally(() => {
      if (this.active === task) this.active = undefined;
      if (this.wakeAgain) {
        this.wakeAgain = false;
        this.requestSync();
      }
    });
    this.active = task;
    return task;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    if (this.scheduled) clearTimeout(this.scheduled);
    this.interval = undefined;
    this.scheduled = undefined;
    await this.active;
  }

  private async processBatch<T extends { readonly playerId: string }>(
    source: Source,
    offset: number,
    list: () => Promise<readonly T[]>,
    project: (item: T) => Promise<void>,
    acknowledge: (item: T) => Promise<boolean>,
  ): Promise<number> {
    try {
      const items = await list();
      let acknowledged = 0;
      for (const item of items) {
        if (this.stopped) break;
        try {
          await project(item);
          if (await acknowledge(item)) acknowledged++;
        } catch (error) {
          this.report(source, error, item.playerId);
        }
      }
      // 成功记录已退出待同步列表；失败记录留待下一轮，继续扫描后续玩家避免饿死。
      return items.length < this.batchSize ? 0 : offset + items.length - acknowledged;
    } catch (error) {
      this.report(source, error);
      return 0;
    }
  }

  private report(source: Source, error: unknown, playerId?: string): void {
    const failure: LeaderboardSyncFailure = {
      source,
      ...(playerId ? { playerId } : {}),
      errorName: error instanceof Error ? error.name : "UnknownError",
    };
    try {
      if (this.options.onError) this.options.onError(failure);
      else console.warn("[LeaderboardSync] 排行榜同步失败，保留待同步标记", failure);
    } catch { /* 日志故障不能中断后续玩家或产生未处理的后台异常。 */ }
  }
}

/** 唤醒故障也不能把已落盘的主数据误报为失败；定时扫描及重启仍可恢复。 */
export function requestLeaderboardSync(service?: Pick<LeaderboardSyncService, "requestSync">): void {
  try { service?.requestSync(); }
  catch (error) {
    console.warn("[LeaderboardSync] 任务唤醒失败，待同步标记仍保留", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
