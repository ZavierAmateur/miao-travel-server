import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { PlatformLoginService } from "../src/domain/auth/PlatformLoginService.js";
import type { PlayerRepository } from "../src/domain/player/PlayerRepository.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import type { PlatformAuthGateway } from "../src/platform/PlatformAuthGateway.js";

const config: AppConfig = {
  environment: AppEnvironment.Test,
  host: "127.0.0.1",
  port: 3000,
  platform: PlatformKind.WeChat,
  appId: "wx-app",
  appSecret: "test-secret",
  logLevel: "error",
  persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "",
  cloudbaseRegion: "",
  cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "",
  cloudDatabaseName: "",
};

describe("PlatformLoginService", () => {
  it("同一平台身份复用 playerId 并只保存 token 哈希", async () => {
    const players = new InMemoryPlayerRepository();
    const sessions = new InMemorySessionRepository();
    const gateway: PlatformAuthGateway = {
      exchangeCode: () => Promise.resolve({
        platform: PlatformKind.WeChat,
        openId: "open-1",
        sessionKey: "platform-secret-session",
      }),
    };
    let tokenIndex = 0;
    const service = new PlatformLoginService({
      config,
      gateway,
      players,
      sessions,
      now: () => 1_000,
      createPlayerId: () => "player-1",
      createToken: () => `token-${++tokenIndex}`,
    });

    const first = await service.login({ code: "first-code" });
    const second = await service.login({ code: "second-code" });

    expect(first).toMatchObject({ playerId: "player-1", isNew: true, token: "token-1" });
    expect(second).toMatchObject({ playerId: "player-1", isNew: false, token: "token-2" });
    const tokenHash = createHash("sha256").update("token-1").digest("hex");
    await expect(sessions.findByTokenHash(tokenHash)).resolves.toMatchObject({
      playerId: "player-1",
      tokenHash,
    });
    await expect(sessions.findByTokenHash("token-1")).resolves.toBeUndefined();
  });

  it("仓储规范化 playerId 后仍把首次登录标记为新用户", async () => {
    const players: PlayerRepository = {
      findByPlatformIdentity: () => Promise.resolve(undefined),
      save: (player) => Promise.resolve({ ...player, id: "canonical-player" }),
    };
    const gateway: PlatformAuthGateway = {
      exchangeCode: () => Promise.resolve({
        platform: PlatformKind.WeChat,
        openId: "open-2",
        sessionKey: "platform-secret-session",
      }),
    };
    const service = new PlatformLoginService({
      config,
      gateway,
      players,
      sessions: new InMemorySessionRepository(),
      createPlayerId: () => "candidate-player",
      createToken: () => "token",
    });

    await expect(service.login({ code: "new-user-code" })).resolves.toMatchObject({
      playerId: "canonical-player",
      isNew: true,
    });
  });
});
