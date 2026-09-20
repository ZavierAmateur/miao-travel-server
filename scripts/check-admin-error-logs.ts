import { randomUUID } from "node:crypto";
import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import { CloudBaseAdminErrorLogRepository } from "../src/infrastructure/repositories/CloudBaseAdminRepositories.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";

const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("error-log:check:wechat 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
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
const collection = database.collection("admin_error_logs");
const repository = new CloudBaseAdminErrorLogRepository(collection);
const id = `p5b6-probe-${randomUUID()}`;
const occurredAt = Date.now();

try {
  await repository.append({
    id,
    occurredAt,
    requestId: id,
    method: "GET",
    path: "/p5b6/probe",
    statusCode: 500,
    code: "P5B6_PROBE",
    message: "错误日志仓储探测",
    errorName: "ProbeError",
  });
  const detail = await repository.findById(id);
  const recent = await repository.listRecent(0, 100);
  if (!detail || !recent.some((log) => log.id === id)) {
    throw new Error("错误日志写入后无法通过详情或时间倒序列表读取");
  }
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    collection: "admin_error_logs",
    detail: true,
    orderedList: true,
  })}\n`);
} finally {
  await collection.doc(id).remove();
}
