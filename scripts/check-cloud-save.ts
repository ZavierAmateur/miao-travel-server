import { randomUUID } from "node:crypto";
import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import type { PutCloudSaveCommand } from "../src/domain/save/CloudSave.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { CloudBaseCloudSaveRepository } from "../src/infrastructure/repositories/CloudBaseCloudSaveRepository.js";

const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("save:check 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
}
assertPersistenceReady(config);

const app = cloudbase.init({
  env: config.cloudbaseEnvId,
  region: config.cloudbaseRegion,
  accessKey: config.cloudbaseApiKey,
  timeout: 8_000,
});
const database = app.database({
  instance: config.cloudbaseDatabaseInstance,
  database: config.cloudDatabaseName,
}) as CloudBaseDatabase;
const collection = database.collection("cloud_saves");
const repository = new CloudBaseCloudSaveRepository(collection, database.command);
const playerId = `p3a-save-probe-${randomUUID()}`;
const first = createCommand(playerId, 0, "p3a-idempotency-first", "request-hash-first", "save-hash-first", 1, true);

try {
  const inserted = await repository.compareAndSet(first);
  if (inserted.status !== "saved" || inserted.record.revision !== 1) throw new Error("首次云存档写入未生成 revision 1");

  const duplicate = await repository.compareAndSet(first);
  if (duplicate.status !== "duplicate" || duplicate.record.revision !== 1) throw new Error("幂等重放未返回原 revision");

  const second = createCommand(playerId, 1, "p3a-idempotency-second", "request-hash-second", "save-hash-second", 2);
  const updated = await repository.compareAndSet(second);
  if (updated.status !== "saved" || updated.record.revision !== 2) throw new Error("条件更新未生成 revision 2");

  const conflict = await repository.compareAndSet({
    ...second,
    idempotencyKey: "p3a-idempotency-conflict",
    requestHash: "request-hash-conflict",
  });
  if (conflict.status !== "conflict" || conflict.current?.revision !== 2) throw new Error("旧 revision 未被拒绝");

  const loaded = await repository.findByPlayerId(playerId);
  if (loaded?.previous?.revision !== 1 || loaded.revision !== 2) throw new Error("当前版或上一版读取不正确");
  const loadedUser = loaded.save.modules.user;
  if (typeof loadedUser !== "object" || loadedUser === null || Array.isArray(loadedUser)) {
    throw new Error("当前云存档 user 结构不正确");
  }
  if ("todayPlayCount" in loadedUser) throw new Error("CloudBase 更新后仍残留已省略的 user 字段");

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    driver: config.persistenceDriver,
    collection: "cloud_saves",
    firstRevision: inserted.record.revision,
    duplicateRevision: duplicate.record.revision,
    currentRevision: loaded.revision,
    previousRevision: loaded.previous.revision,
    conflictRevision: conflict.current.revision,
  })}\n`);
} finally {
  await collection.doc(playerId).remove();
}

function createCommand(
  playerId: string,
  baseRevision: number,
  idempotencyKey: string,
  requestHash: string,
  hash: string,
  level: number,
  includeLegacyField = false,
): PutCloudSaveCommand {
  const now = Date.now();
  return {
    playerId,
    baseRevision,
    clientVersion: "3.4.2",
    clientSavedAt: now,
    serverSavedAt: now,
    idempotencyKey,
    requestHash,
    hash,
    sizeBytes: 128,
    save: {
      version: "3.4.2",
      serialized: 1,
      time: now,
      modules: { user: { level, ...(includeLegacyField ? { todayPlayCount: 8 } : {}) } },
    },
  };
}
