import type {
  CloudSaveRecord,
  PutCloudSaveCommand,
  PutCloudSaveResult,
  RollbackCloudSaveCommand,
  RollbackCloudSaveResult,
} from "../../domain/save/CloudSave.js";
import type { CloudSaveRepository } from "../../domain/save/CloudSaveRepository.js";
import type {
  CloudBaseCollectionReference,
  CloudBaseCommand,
} from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";
import { toSnapshot } from "./InMemoryCloudSaveRepository.js";

interface CloudSaveDocument extends Omit<CloudSaveRecord, "playerId"> {
  readonly _id?: string;
  readonly playerId?: string;
}

export class CloudBaseCloudSaveRepository implements CloudSaveRepository {
  constructor(
    private readonly collection: CloudBaseCollectionReference,
    private readonly databaseCommand: CloudBaseCommand,
  ) {}

  async findByPlayerId(playerId: string): Promise<CloudSaveRecord | undefined> {
    try {
      const result = await this.collection.doc(playerId).get();
      return this.toRecord(playerId, result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }

  async compareAndSet(command: PutCloudSaveCommand): Promise<PutCloudSaveResult> {
    const current = await this.findByPlayerId(command.playerId);
    const duplicate = this.asDuplicate(current, command);
    if (duplicate) return duplicate;
    if ((current?.revision ?? 0) !== command.baseRevision) {
      return { status: "conflict", ...(current ? { current } : {}) };
    }

    const record = this.createRecord(command, current);
    if (!current) return this.insertFirst(record, command);

    const result = await this.collection.where({
      _id: command.playerId,
      revision: command.baseRevision,
    }).update(this.toUpdateDocument(record));
    if (result.updated === 1) return { status: "saved", record };
    return this.resolveConcurrentWrite(command);
  }

  async rollbackPrevious(command: RollbackCloudSaveCommand): Promise<RollbackCloudSaveResult> {
    const current = await this.findByPlayerId(command.playerId);
    if (!current || current.revision !== command.expectedRevision) {
      return { status: "conflict", ...(current ? { current } : {}) };
    }
    if (!current.previous) return { status: "no_previous", current };
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
    const result = await this.collection.where({
      _id: command.playerId,
      revision: command.expectedRevision,
    }).update(this.toUpdateDocument(record));
    if (result.updated === 1) return { status: "saved", record, sourceRevision: source.revision };
    const after = await this.findByPlayerId(command.playerId);
    return { status: "conflict", ...(after ? { current: after } : {}) };
  }

  private async insertFirst(record: CloudSaveRecord, command: PutCloudSaveCommand): Promise<PutCloudSaveResult> {
    try {
      await this.collection.add({ _id: command.playerId, ...this.toDocument(record) });
      return { status: "saved", record };
    } catch (error) {
      const after = await this.findByPlayerId(command.playerId);
      if (!after) throw error;
      return this.asDuplicate(after, command) ?? { status: "conflict", current: after };
    }
  }

  private async resolveConcurrentWrite(command: PutCloudSaveCommand): Promise<PutCloudSaveResult> {
    const after = await this.findByPlayerId(command.playerId);
    return this.asDuplicate(after, command)
      ?? { status: "conflict", ...(after ? { current: after } : {}) };
  }

  private asDuplicate(current: CloudSaveRecord | undefined, command: PutCloudSaveCommand): PutCloudSaveResult | undefined {
    if (current?.lastIdempotencyKey === command.idempotencyKey
      && current.lastRequestHash === command.requestHash) {
      return { status: "duplicate", record: current };
    }
    return undefined;
  }

  private createRecord(command: PutCloudSaveCommand, current?: CloudSaveRecord): CloudSaveRecord {
    return {
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
  }

  private toDocument(record: CloudSaveRecord): CloudSaveDocument {
    return {
      revision: record.revision,
      clientVersion: record.clientVersion,
      clientSavedAt: record.clientSavedAt,
      serverSavedAt: record.serverSavedAt,
      hash: record.hash,
      sizeBytes: record.sizeBytes,
      save: record.save,
      lastIdempotencyKey: record.lastIdempotencyKey,
      lastRequestHash: record.lastRequestHash,
      ...(record.previous ? { previous: record.previous } : {}),
    };
  }

  private toUpdateDocument(record: CloudSaveRecord): CloudSaveDocument {
    return {
      revision: record.revision,
      clientVersion: record.clientVersion,
      clientSavedAt: record.clientSavedAt,
      serverSavedAt: record.serverSavedAt,
      hash: record.hash,
      sizeBytes: record.sizeBytes,
      // CloudBase update 默认会递归合并对象；set 指令确保省略的历史键被真正删除。
      save: this.databaseCommand.set(record.save) as CloudSaveRecord["save"],
      lastIdempotencyKey: record.lastIdempotencyKey,
      lastRequestHash: record.lastRequestHash,
      ...(record.previous
        ? { previous: this.databaseCommand.set(record.previous) as NonNullable<CloudSaveRecord["previous"]> }
        : {}),
    };
  }

  private toRecord(playerId: string, value: unknown): CloudSaveRecord | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const document = value as CloudSaveDocument;
    if (!Number.isSafeInteger(document.revision) || document.revision < 1) return undefined;
    return {
      playerId,
      revision: document.revision,
      clientVersion: document.clientVersion,
      clientSavedAt: document.clientSavedAt,
      serverSavedAt: document.serverSavedAt,
      hash: document.hash,
      sizeBytes: document.sizeBytes,
      save: document.save,
      lastIdempotencyKey: document.lastIdempotencyKey,
      lastRequestHash: document.lastRequestHash,
      ...(document.previous ? { previous: document.previous } : {}),
    };
  }
}
