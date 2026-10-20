import type { CloudSaveRecord, PutCloudSaveCommand, PutCloudSaveResult, RollbackCloudSaveCommand, RollbackCloudSaveResult } from "./CloudSave.js";

export interface CloudSaveRepository {
  findByPlayerId(playerId: string): Promise<CloudSaveRecord | undefined>;
  listPendingLeaderboardSync(limit: number, offset: number): Promise<readonly CloudSaveRecord[]>;
  markLeaderboardSynced(playerId: string, revision: number): Promise<boolean>;
  compareAndSet(command: PutCloudSaveCommand): Promise<PutCloudSaveResult>;
  rollbackPrevious(command: RollbackCloudSaveCommand): Promise<RollbackCloudSaveResult>;
}
