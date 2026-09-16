import type { CloudSaveRecord, CloudSaveSnapshot, PutCloudSaveCommand, PutCloudSaveResult } from "../../domain/save/CloudSave.js";
import type { CloudSaveRepository } from "../../domain/save/CloudSaveRepository.js";

export class InMemoryCloudSaveRepository implements CloudSaveRepository {
  private readonly records = new Map<string, CloudSaveRecord>();

  findByPlayerId(playerId: string): Promise<CloudSaveRecord | undefined> {
    return Promise.resolve(this.records.get(playerId));
  }

  compareAndSet(command: PutCloudSaveCommand): Promise<PutCloudSaveResult> {
    const current = this.records.get(command.playerId);
    if (current?.lastIdempotencyKey === command.idempotencyKey
      && current.lastRequestHash === command.requestHash) {
      return Promise.resolve({ status: "duplicate", record: current });
    }
    if ((current?.revision ?? 0) !== command.baseRevision) {
      return Promise.resolve({ status: "conflict", ...(current ? { current } : {}) });
    }
    const record: CloudSaveRecord = {
      playerId: command.playerId,
      revision: command.baseRevision + 1,
      clientVersion: command.clientVersion,
      clientSavedAt: command.clientSavedAt,
      serverSavedAt: command.serverSavedAt,
      hash: command.hash,
      sizeBytes: command.sizeBytes,
      save: command.save,
      lastIdempotencyKey: command.idempotencyKey,
      lastRequestHash: command.requestHash,
      ...(current ? { previous: toSnapshot(current) } : {}),
    };
    this.records.set(command.playerId, record);
    return Promise.resolve({ status: "saved", record });
  }
}

export function toSnapshot(record: CloudSaveRecord): CloudSaveSnapshot {
  return {
    revision: record.revision,
    clientVersion: record.clientVersion,
    clientSavedAt: record.clientSavedAt,
    serverSavedAt: record.serverSavedAt,
    hash: record.hash,
    sizeBytes: record.sizeBytes,
    save: record.save,
  };
}
