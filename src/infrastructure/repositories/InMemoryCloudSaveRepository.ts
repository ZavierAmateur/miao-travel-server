import type { CloudSaveRecord, CloudSaveSnapshot, PutCloudSaveCommand, PutCloudSaveResult, RollbackCloudSaveCommand, RollbackCloudSaveResult } from "../../domain/save/CloudSave.js";
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

  rollbackPrevious(command: RollbackCloudSaveCommand): Promise<RollbackCloudSaveResult> {
    const current = this.records.get(command.playerId);
    if (!current || current.revision !== command.expectedRevision) {
      return Promise.resolve({ status: "conflict", ...(current ? { current } : {}) });
    }
    if (!current.previous) return Promise.resolve({ status: "no_previous", current });
    const source = current.previous;
    const record: CloudSaveRecord = {
      playerId: current.playerId,
      revision: current.revision + 1,
      clientVersion: source.clientVersion,
      clientSavedAt: source.clientSavedAt,
      serverSavedAt: command.serverSavedAt,
      hash: source.hash,
      sizeBytes: source.sizeBytes,
      save: source.save,
      lastIdempotencyKey: `admin-rollback:${command.auditKey}`,
      lastRequestHash: `admin-rollback:${command.auditKey}`,
      previous: toSnapshot(current),
    };
    this.records.set(command.playerId, record);
    return Promise.resolve({ status: "saved", record, sourceRevision: source.revision });
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
