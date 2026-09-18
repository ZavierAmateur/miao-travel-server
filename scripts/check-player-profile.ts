import { randomUUID } from "node:crypto";
import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { CloudBasePlayerProfileRepository } from "../src/infrastructure/repositories/CloudBasePlayerProfileRepository.js";

const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("profile:check 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
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
const collection = database.collection("player_profiles");
const repository = new CloudBasePlayerProfileRepository(collection);
const playerId = `profile-probe-${randomUUID()}`;

try {
  await repository.save({
    playerId,
    nickName: "旅行测试猫",
    avatarUrl: "https://example.com/avatar-1.png",
    updatedAt: 100,
  });
  const first = await repository.findByPlayerId(playerId);
  if (first?.nickName !== "旅行测试猫" || first.updatedAt !== 100) throw new Error("玩家资料首次写入或读取失败");

  await repository.save({
    playerId,
    nickName: "更新测试猫",
    avatarUrl: "https://example.com/avatar-2.png",
    updatedAt: 200,
  });
  const updated = await repository.findByPlayerId(playerId);
  if (updated?.nickName !== "更新测试猫" || updated.updatedAt !== 200) throw new Error("玩家资料更新失败");

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    driver: config.persistenceDriver,
    collection: "player_profiles",
    firstUpdatedAt: first.updatedAt,
    currentUpdatedAt: updated.updatedAt,
  })}\n`);
} finally {
  await collection.doc(playerId).remove();
}
