import type { CloudSaveRecord, PutCloudSaveCommand, PutCloudSaveResult } from "./CloudSave.js";

export interface CloudSaveRepository {
  findByPlayerId(playerId: string): Promise<CloudSaveRecord | undefined>;
  compareAndSet(command: PutCloudSaveCommand): Promise<PutCloudSaveResult>;
}
