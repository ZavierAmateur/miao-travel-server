import { buildApp } from "./app.js";
import { assertPersistenceReady, loadConfig } from "./config/AppConfig.js";
import { PlatformLoginService } from "./domain/auth/PlatformLoginService.js";
import { CloudSaveService } from "./domain/save/CloudSaveService.js";
import { createPersistence } from "./infrastructure/persistence/createPersistence.js";
import { createPlatformAuthGateway } from "./platform/createPlatformAuthGateway.js";

const config = loadConfig();
assertPersistenceReady(config);
const persistence = await createPersistence(config);
const platformLoginService = new PlatformLoginService({
  config,
  gateway: createPlatformAuthGateway(config),
  players: persistence.players,
  sessions: persistence.sessions,
});
const cloudSaveService = new CloudSaveService({
  sessions: persistence.sessions,
  saves: persistence.saves,
});
const app = buildApp({ config, platformLoginService, cloudSaveService });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "开始优雅关闭服务");
  try {
    await app.close();
  } finally {
    await persistence.close();
  }
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "服务启动失败");
  await persistence.close();
  process.exitCode = 1;
}
