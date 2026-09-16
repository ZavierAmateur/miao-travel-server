import type { Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import { PlayerStatus, type Player } from "../src/domain/player/Player.js";
import { hashPlatformIdentity } from "../src/infrastructure/persistence/IdentityHash.js";
import {
  MongoPlayerRepository,
  type MongoPlayerDocument,
} from "../src/infrastructure/repositories/MongoPlayerRepository.js";
import {
  MongoSessionRepository,
  type MongoSessionDocument,
} from "../src/infrastructure/repositories/MongoSessionRepository.js";

describe("MongoPlayerRepository", () => {
  it("用身份哈希查询且不把明文 openid 写入数据库", async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: "hashed-identity",
      id: "player-1",
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      status: PlayerStatus.Active,
      createdAt: 100,
      lastLoginAt: 200,
    });
    const collection = { findOne } as unknown as Collection<MongoPlayerDocument>;
    const repository = new MongoPlayerRepository(collection);
    const identity = { platform: PlatformKind.WeChat, appId: "wx-app", openId: "private-open-id" };

    await expect(repository.findByPlatformIdentity(identity)).resolves.toMatchObject({
      id: "player-1",
      platformOpenId: "private-open-id",
    });
    expect(findOne).toHaveBeenCalledWith({ _id: hashPlatformIdentity(identity) });
    expect(JSON.stringify(findOne.mock.calls)).not.toContain("private-open-id");
  });

  it("并发首次登录时返回唯一键下已经落库的规范玩家", async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({
      _id: "hashed-identity",
      id: "canonical-player",
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      status: PlayerStatus.Active,
      createdAt: 100,
      lastLoginAt: 200,
    });
    const collection = { findOneAndUpdate } as unknown as Collection<MongoPlayerDocument>;
    const repository = new MongoPlayerRepository(collection);
    const candidate: Player = {
      id: "racing-player",
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      platformOpenId: "private-open-id",
      unionId: "private-union-id",
      status: PlayerStatus.Active,
      createdAt: 100,
      lastLoginAt: 200,
    };

    await expect(repository.save(candidate)).resolves.toMatchObject({ id: "canonical-player" });
    const serializedCall = JSON.stringify(findOneAndUpdate.mock.calls);
    expect(serializedCall).not.toContain("private-open-id");
    expect(serializedCall).not.toContain("private-union-id");
  });
});

describe("MongoSessionRepository", () => {
  it("仅以 token 哈希为主键并写入 TTL 日期", async () => {
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const collection = { updateOne } as unknown as Collection<MongoSessionDocument>;
    const repository = new MongoSessionRepository(collection);

    await repository.save({
      tokenHash: "hashed-token",
      playerId: "player-1",
      createdAt: 100,
      expiresAt: 2_000,
    });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "hashed-token" },
      {
        $set: {
          playerId: "player-1",
          createdAt: 100,
          expiresAt: 2_000,
          expiresAtDate: new Date(2_000),
        },
      },
      { upsert: true },
    );
  });
});
