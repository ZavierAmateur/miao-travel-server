import { describe, expect, it } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import { PlayerStatus, type Player } from "../src/domain/player/Player.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";

describe("InMemoryPlayerRepository", () => {
  it("以平台、应用和 openId 共同隔离玩家", async () => {
    const repository = new InMemoryPlayerRepository();
    const player: Player = {
      id: "player-1",
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      platformOpenId: "open-1",
      status: PlayerStatus.Active,
      createdAt: 100,
      lastLoginAt: 100,
    };
    await repository.save(player);

    await expect(repository.findByPlatformIdentity({
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      openId: "open-1",
    })).resolves.toEqual(player);

    await expect(repository.findByPlatformIdentity({
      platform: PlatformKind.ByteDance,
      appId: "wx-app",
      openId: "open-1",
    })).resolves.toBeUndefined();
  });
});
