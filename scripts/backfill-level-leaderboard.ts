import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, assertPersistenceReady, loadConfig } from "../src/config/AppConfig.js";
import type { CloudSavePayload } from "../src/domain/save/CloudSave.js";
import { LevelLeaderboardProjector } from "../src/domain/leaderboard/LevelLeaderboardProjector.js";
import type { CloudBaseDatabase } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { CloudBaseLevelLeaderboardRepository } from "../src/infrastructure/repositories/CloudBaseLevelLeaderboardRepository.js";
import { CloudBasePlayerProfileRepository } from "../src/infrastructure/repositories/CloudBasePlayerProfileRepository.js";
import { CloudBasePlayerRepository } from "../src/infrastructure/repositories/CloudBasePlayerRepository.js";

const BATCH_SIZE = 100;
const config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) {
  throw new Error("leaderboard:backfill 仅允许在 PERSISTENCE_DRIVER=cloudbase-http 时运行");
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
const projector = new LevelLeaderboardProjector({
  leaderboard: new CloudBaseLevelLeaderboardRepository(database.collection("level_leaderboard")),
  players: new CloudBasePlayerRepository(database.collection("players")),
  profiles: new CloudBasePlayerProfileRepository(database.collection("player_profiles")),
});

let offset = 0;
let projected = 0;
let skipped = 0;
while (true) {
  const result = await database.collection("cloud_saves").where({})
    .orderBy("serverSavedAt", "asc")
    .skip(offset)
    .limit(BATCH_SIZE)
    .get();
  for (const value of result.data) {
    const record = parseSaveDocument(value);
    if (!record) {
      skipped += 1;
      continue;
    }
    await projector.syncSave(record.playerId, record.save, record.serverSavedAt);
    projected += 1;
  }
  offset += result.data.length;
  if (result.data.length < BATCH_SIZE) break;
}

process.stdout.write(`${JSON.stringify({
  status: "ok",
  collection: "level_leaderboard",
  projected,
  skipped,
})}\n`);

function parseSaveDocument(value: unknown): {
  readonly playerId: string;
  readonly save: CloudSavePayload;
  readonly serverSavedAt: number;
} | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record._id !== "string" || !Number.isSafeInteger(record.serverSavedAt)
    || typeof record.save !== "object" || record.save === null) return undefined;
  return {
    playerId: record._id,
    save: record.save as CloudSavePayload,
    serverSavedAt: record.serverSavedAt as number,
  };
}
