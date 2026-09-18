import type { CloudSaveRecord, PutCloudSaveCommand, PutCloudSaveResult, RollbackCloudSaveCommand, RollbackCloudSaveResult } from "./CloudSave.js";

export interface CloudSaveRepository {
  findByPlayerId(playerId: string): Promise<CloudSaveRecord | undefined>;
  compareAndSet(command: PutCloudSaveCommand): Promise<PutCloudSaveResult>;
  rollbackPrevious(command: RollbackCloudSaveCommand): Promise<RollbackCloudSaveResult>;
}
