import cloudbase from "@cloudbase/js-sdk";
import {
  DEFAULT_BOOTSTRAP_CONFIG,
  validateBootstrapConfigRecord,
} from "../src/domain/config/BootstrapConfig.js";
import { CloudBaseBootstrapConfigRepository } from "../src/infrastructure/repositories/CloudBaseBootstrapConfigRepository.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import { isMissingCollection, isMissingDocument } from "./cloudbase-probe-errors.js";

const dryRun = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(argument => argument !== "--dry-run")) throw new Error("只支持 --dry-run 参数");
if (!dryRun && process.env.BOOTSTRAP_CONFIG_CONFIRM !== "PUBLISH") {
  throw new Error("发布远程配置前必须设置 BOOTSTRAP_CONFIG_CONFIRM=PUBLISH");
}

const appConfig = loadConfig();
if (appConfig.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("远程配置发布仅支持 PERSISTENCE_DRIVER=cloudbase-http");
}
assertPersistenceReady(appConfig);

const app = cloudbase.init({
  env: appConfig.cloudbaseEnvId,
  region: appConfig.cloudbaseRegion,
  accessKey: appConfig.cloudbaseApiKey,
  timeout: 8_000,
});
const database = app.database({
  instance: appConfig.cloudbaseDatabaseInstance,
  database: appConfig.cloudDatabaseName,
}) as CloudBaseDatabase;
if (!dryRun) await ensureCollection(database, "remote_configs");

const repository = new CloudBaseBootstrapConfigRepository(database.collection("remote_configs"));
const current = await repository.find() ?? DEFAULT_BOOTSTRAP_CONFIG;
const next = validateBootstrapConfigRecord({
  revision: current.revision + 1,
  maintenanceEnabled: readBoolean("BOOTSTRAP_MAINTENANCE_ENABLED", current.maintenanceEnabled),
  maintenanceMessage: process.env.BOOTSTRAP_MAINTENANCE_MESSAGE ?? current.maintenanceMessage,
  minimumClientVersion: process.env.BOOTSTRAP_MINIMUM_CLIENT_VERSION ?? current.minimumClientVersion,
  latestClientVersion: process.env.BOOTSTRAP_LATEST_CLIENT_VERSION ?? current.latestClientVersion ?? "",
  cloudSaveEnabled: readBoolean("BOOTSTRAP_CLOUD_SAVE_ENABLED", current.cloudSaveEnabled),
  updatedAt: Date.now(),
  updatedBy: process.env.BOOTSTRAP_UPDATED_BY?.trim() || "manual-cli",
});
if (!dryRun && !await repository.compareAndSet(current.revision, next)) {
  throw new Error("启动配置已被修改，请重新预览后再发布");
}

process.stdout.write(`${JSON.stringify({
  status: dryRun ? "dry-run" : "published",
  platform: appConfig.platform,
  environment: appConfig.environment,
  revision: next.revision,
  maintenanceEnabled: next.maintenanceEnabled,
  minimumClientVersion: next.minimumClientVersion,
  latestClientVersion: next.latestClientVersion,
  cloudSaveEnabled: next.cloudSaveEnabled,
  updatedAt: next.updatedAt,
  updatedBy: next.updatedBy,
})}\n`);

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} 只能是 true 或 false`);
}

async function ensureCollection(database: CloudBaseDatabase, name: string): Promise<void> {
  const probe = database.collection(name).doc("__bootstrap_config_collection_probe__");
  try {
    await probe.get();
  } catch (error) {
    if (isMissingDocument(error)) return;
    if (!isMissingCollection(error)) throw error;
    if (!database.createCollection) throw new Error("当前 CloudBase SDK 未提供集合创建能力");
    await database.createCollection(name);
  }
}
