import { randomUUID } from "node:crypto";
import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { isMissingCollection, isMissingDocument } from "./cloudbase-probe-errors.js";

const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("db:check 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
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

const collectionNames = ["players", "sessions", "cloud_saves"] as const;
for (const collectionName of collectionNames) {
  await ensureCollection(database, collectionName);
}

const probeId = `p2b2-probe-${randomUUID()}`;
const probe = database.collection("sessions").doc(probeId);
const writeResult = await probe.set({
  kind: "p2b2-connectivity-probe",
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
});
try {
  const readResult = await probe.get();
  if (readResult.data.length !== 1) throw new Error("CloudBase 探测记录写入后未读到");
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    driver: config.persistenceDriver,
    region: config.cloudbaseRegion,
    database: config.cloudDatabaseName,
    collections: collectionNames,
    writeRequestId: writeResult.requestId,
    readRequestId: readResult.requestId,
  })}\n`);
} finally {
  await probe.remove();
}

async function ensureCollection(database: CloudBaseDatabase, name: string): Promise<void> {
  const probe = database.collection(name).doc("__p2b2_collection_probe__");
  try {
    await probe.get();
  } catch (error) {
    if (isMissingDocument(error)) return;
    if (!isMissingCollection(error)) throw error;
    if (!database.createCollection) throw new Error("当前 CloudBase SDK 未提供集合创建能力");
    await database.createCollection(name);
  }
}
