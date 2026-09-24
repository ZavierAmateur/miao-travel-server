import { createHash } from "node:crypto";
import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import type { CloudSavePayload, CloudSaveSnapshot } from "../src/domain/save/CloudSave.js";
import { stableStringify } from "../src/domain/save/CloudSaveValidation.js";
import { cleanupLegacyPetState } from "../src/domain/save/PetSaveCleanup.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";

const BATCH_SIZE = 100;
const apply = process.argv.includes("--apply");
const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("save:cleanup-pets 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
}
if (apply && process.env.NODE_ENV === "production") {
  throw new Error("拒绝在 NODE_ENV=production 执行开发期宠物存档清理");
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

let offset = 0;
let scanned = 0;
let changed = 0;
let updated = 0;
let removedAnimalCount = 0;
let removedLegacyFieldCount = 0;

while (true) {
  const result = await collection.where({})
    .orderBy("serverSavedAt", "asc")
    .skip(offset)
    .limit(BATCH_SIZE)
    .get();

  for (const value of result.data) {
    const record = parseCloudSaveDocument(value);
    scanned += 1;
    if (!record) continue;

    const current = cleanupLegacyPetState(record.save);
    const previous = record.previous ? cleanupLegacyPetState(record.previous.save) : undefined;
    if (!current.changed && !previous?.changed) continue;

    changed += 1;
    removedAnimalCount += current.removedAnimalCount + (previous?.removedAnimalCount ?? 0);
    removedLegacyFieldCount += current.removedLegacyFieldCount + (previous?.removedLegacyFieldCount ?? 0);
    if (!apply) continue;

    const currentIntegrity = getSaveIntegrity(current.save);
    const updateDocument: Record<string, unknown> = {
      save: database.command.set(current.save),
      hash: currentIntegrity.hash,
      sizeBytes: currentIntegrity.sizeBytes,
      lastRequestHash: hash(stableStringify({
        baseRevision: Math.max(0, record.revision - 1),
        clientVersion: record.clientVersion,
        clientSavedAt: record.clientSavedAt,
        saveHash: currentIntegrity.hash,
      })),
    };
    if (record.previous && previous) {
      const previousIntegrity = getSaveIntegrity(previous.save);
      updateDocument.previous = database.command.set({
        ...record.previous,
        ...previousIntegrity,
        save: previous.save,
      });
    }
    const updateResult = await collection.where({ _id: record.playerId }).update(updateDocument);
    if (updateResult.updated !== 1) {
      throw new Error(`宠物存档清理更新数量异常: ${record.playerId}`);
    }
    updated += 1;
  }

  offset += result.data.length;
  if (result.data.length < BATCH_SIZE) break;
}

process.stdout.write(`${JSON.stringify({
  status: "ok",
  mode: apply ? "apply" : "dry-run",
  environment: process.env.NODE_ENV ?? "unknown",
  target: hash(config.cloudbaseEnvId).slice(0, 12),
  database: config.cloudDatabaseName,
  collection: "cloud_saves",
  scanned,
  changed,
  updated,
  removedAnimalCount,
  removedLegacyFieldCount,
})}\n`);

function getSaveIntegrity(save: CloudSavePayload): { hash: string; sizeBytes: number } {
  const canonical = stableStringify(save);
  return {
    hash: hash(canonical),
    sizeBytes: Buffer.byteLength(canonical, "utf8"),
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCloudSaveDocument(value: unknown): {
  readonly playerId: string;
  readonly revision: number;
  readonly clientVersion: string;
  readonly clientSavedAt: number;
  readonly save: CloudSavePayload;
  readonly previous?: CloudSaveSnapshot;
} | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record._id !== "string" || !Number.isSafeInteger(record.revision)
    || typeof record.clientVersion !== "string" || !Number.isSafeInteger(record.clientSavedAt)
    || typeof record.save !== "object" || record.save === null) return undefined;
  return {
    playerId: record._id,
    revision: record.revision as number,
    clientVersion: record.clientVersion,
    clientSavedAt: record.clientSavedAt as number,
    save: record.save as CloudSavePayload,
    ...(typeof record.previous === "object" && record.previous !== null
      ? { previous: record.previous as CloudSaveSnapshot }
      : {}),
  };
}
