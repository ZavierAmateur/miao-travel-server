import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { PlatformLoginService } from "../src/domain/auth/PlatformLoginService.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import type { PlatformAuthGateway } from "../src/platform/PlatformAuthGateway.js";

const config: AppConfig = {
  environment: AppEnvironment.Test,
  host: "127.0.0.1",
  port: 43_128,
  platform: PlatformKind.WeChat,
  appId: "acceptance-app",
  appSecret: "acceptance-secret",
  logLevel: "error",
  persistenceDriver: PersistenceDriver.Memory,
  cloudDatabaseUri: "",
  cloudDatabaseName: "",
};
const gateway: PlatformAuthGateway = {
  exchangeCode: () => Promise.resolve({
    platform: PlatformKind.WeChat,
    openId: "acceptance-open-id",
    sessionKey: "acceptance-platform-session",
  }),
};
const service = new PlatformLoginService({
  config,
  gateway,
  players: new InMemoryPlayerRepository(),
  sessions: new InMemorySessionRepository(),
  createPlayerId: () => "acceptance-player",
  createToken: () => "acceptance-server-token",
});
const app = buildApp({ config, platformLoginService: service });

process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());
await app.listen({ host: config.host, port: config.port });
