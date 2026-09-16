import { buildApp } from "./app.js";
import { assertPersistenceReady, loadConfig } from "./config/AppConfig.js";
import { PlatformLoginService } from "./domain/auth/PlatformLoginService.js";
import { InMemoryPlayerRepository } from "./infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "./infrastructure/repositories/InMemorySessionRepository.js";
import { createPlatformAuthGateway } from "./platform/createPlatformAuthGateway.js";

const config = loadConfig();
assertPersistenceReady(config, "memory");
const platformLoginService = new PlatformLoginService({
  config,
  gateway: createPlatformAuthGateway(config),
  players: new InMemoryPlayerRepository(),
  sessions: new InMemorySessionRepository(),
});
const app = buildApp({ config, platformLoginService });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "开始优雅关闭服务");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "服务启动失败");
  process.exitCode = 1;
}
