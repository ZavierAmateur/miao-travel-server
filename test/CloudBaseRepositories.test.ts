import { describe, expect, it, vi } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import { PlayerStatus, type Player } from "../src/domain/player/Player.js";
import type {
  CloudBaseCollectionReference,
  CloudBaseDocumentReference,
} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { hashPlatformIdentity } from "../src/infrastructure/persistence/IdentityHash.js";
import { CloudBasePlayerRepository } from "../src/infrastructure/repositories/CloudBasePlayerRepository.js";
import { CloudBaseSessionRepository } from "../src/infrastructure/repositories/CloudBaseSessionRepository.js";

function collectionWithDocument(document: Partial<CloudBaseDocumentReference>) {
  const doc = vi.fn(() => document as CloudBaseDocumentReference);
  return { collection: { doc } as CloudBaseCollectionReference, doc };
}

describe("CloudBasePlayerRepository", () => {
  it("首次登录读取不存在的玩家文档时返回未找到", async () => {
    const get = vi.fn().mockRejectedValue({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document not found",
    });
    const { collection } = collectionWithDocument({ get });
    const repository = new CloudBasePlayerRepository(collection);

    await expect(repository.findByPlatformIdentity({
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      openId: "new-user-open-id",
    })).resolves.toBeUndefined();
  });

  it("查询玩家时不吞掉权限等未知数据库错误", async () => {
    const error = { code: "PERMISSION_DENIED", message: "Permission denied" };
    const get = vi.fn().mockRejectedValue(error);
    const { collection } = collectionWithDocument({ get });
    const repository = new CloudBasePlayerRepository(collection);

    await expect(repository.findByPlatformIdentity({
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      openId: "private-open-id",
    })).rejects.toBe(error);
  });

  it("用身份哈希查询且不把明文 openid 写入数据库", async () => {
    const get = vi.fn().mockResolvedValue({
      requestId: "request-1",
      data: [{
        id: "player-1",
        platform: PlatformKind.WeChat,
        appId: "wx-app",
        status: PlayerStatus.Active,
        createdAt: 100,
        lastLoginAt: 200,
      }],
    });
    const { collection, doc } = collectionWithDocument({ get });
    const repository = new CloudBasePlayerRepository(collection);
    const identity = { platform: PlatformKind.WeChat, appId: "wx-app", openId: "private-open-id" };

    await expect(repository.findByPlatformIdentity(identity)).resolves.toMatchObject({
      id: "player-1",
      platformOpenId: "private-open-id",
    });
    expect(doc).toHaveBeenCalledWith(hashPlatformIdentity(identity));
    expect(JSON.stringify(doc.mock.calls)).not.toContain("private-open-id");
  });

  it("相同平台身份始终写入相同玩家 ID 且敏感标识只保存哈希", async () => {
    const set = vi.fn().mockResolvedValue({ requestId: "request-2" });
    const { collection } = collectionWithDocument({ set });
    const repository = new CloudBasePlayerRepository(collection);
    const candidate: Player = {
      id: "random-candidate",
      platform: PlatformKind.WeChat,
      appId: "wx-app",
      platformOpenId: "private-open-id",
      unionId: "private-union-id",
      status: PlayerStatus.Active,
      createdAt: 100,
      lastLoginAt: 200,
    };

    const first = await repository.save(candidate);
    const second = await repository.save({ ...candidate, id: "another-candidate" });
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const serializedCall = JSON.stringify(set.mock.calls);
    expect(serializedCall).not.toContain("private-open-id");
    expect(serializedCall).not.toContain("private-union-id");
  });
});

describe("CloudBaseSessionRepository", () => {
  it("读取不存在的会话文档时返回未找到", async () => {
    const get = vi.fn().mockRejectedValue({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document not found",
    });
    const { collection } = collectionWithDocument({ get });
    const repository = new CloudBaseSessionRepository(collection);

    await expect(repository.findByTokenHash("missing-token-hash")).resolves.toBeUndefined();
  });

  it("仅以 token 哈希为文档主键", async () => {
    const set = vi.fn().mockResolvedValue({ requestId: "request-3" });
    const { collection, doc } = collectionWithDocument({ set });
    const repository = new CloudBaseSessionRepository(collection);

    await repository.save({
      tokenHash: "hashed-token",
      playerId: "player-1",
      createdAt: 100,
      expiresAt: 2_000,
    });

    expect(doc).toHaveBeenCalledWith("hashed-token");
    expect(set).toHaveBeenCalledWith({
      playerId: "player-1",
      createdAt: 100,
      expiresAt: 2_000,
    });
  });
});
