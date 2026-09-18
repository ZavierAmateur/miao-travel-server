import { describe, expect, it, vi } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import { PlayerStatus, type Player } from "../src/domain/player/Player.js";
import type {
  CloudBaseCollectionReference,
  CloudBaseCommand,
  CloudBaseDocumentReference,
} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { hashPlatformIdentity } from "../src/infrastructure/persistence/IdentityHash.js";
import { CloudBasePlayerRepository } from "../src/infrastructure/repositories/CloudBasePlayerRepository.js";
import { CloudBaseSessionRepository } from "../src/infrastructure/repositories/CloudBaseSessionRepository.js";
import { CloudBaseCloudSaveRepository } from "../src/infrastructure/repositories/CloudBaseCloudSaveRepository.js";
import { CloudBaseBootstrapConfigRepository } from "../src/infrastructure/repositories/CloudBaseBootstrapConfigRepository.js";
import { CloudBasePlayerProfileRepository } from "../src/infrastructure/repositories/CloudBasePlayerProfileRepository.js";

function collectionWithDocument(document: Partial<CloudBaseDocumentReference>) {
  const doc = vi.fn(() => document as CloudBaseDocumentReference);
  const collection = {
    doc,
    add: vi.fn(),
    where: vi.fn(),
  } as unknown as CloudBaseCollectionReference;
  return { collection, doc };
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

describe("CloudBasePlayerProfileRepository", () => {
  it("以 playerId 为文档主键，且只保存昵称、头像地址和更新时间", async () => {
    const set = vi.fn().mockResolvedValue({ requestId: "profile-write" });
    const { collection, doc } = collectionWithDocument({ set });
    const repository = new CloudBasePlayerProfileRepository(collection);

    await repository.save({
      playerId: "player-profile-1",
      nickName: "旅行猫",
      avatarUrl: "https://example.com/avatar.png",
      updatedAt: 2_000,
    });

    expect(doc).toHaveBeenCalledWith("player-profile-1");
    expect(set).toHaveBeenCalledWith({
      nickName: "旅行猫",
      avatarUrl: "https://example.com/avatar.png",
      updatedAt: 2_000,
    });
  });

  it("资料文档不存在时返回未设置", async () => {
    const get = vi.fn().mockRejectedValue({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document not found",
    });
    const { collection } = collectionWithDocument({ get });
    const repository = new CloudBasePlayerProfileRepository(collection);

    await expect(repository.findByPlayerId("missing-player")).resolves.toBeUndefined();
  });
});

describe("CloudBaseBootstrapConfigRepository", () => {
  it("固定使用 bootstrap 文档并保留内部发布审计字段", async () => {
    const set = vi.fn().mockResolvedValue({ requestId: "config-write" });
    const { collection, doc } = collectionWithDocument({ set });
    const repository = new CloudBaseBootstrapConfigRepository(collection);
    const record = {
      revision: 4,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minimumClientVersion: "3.4.2",
      cloudSaveEnabled: true,
      updatedAt: 2_000,
      updatedBy: "operator",
    };

    await repository.save(record);

    expect(doc).toHaveBeenCalledWith("bootstrap");
    expect(set).toHaveBeenCalledWith(record);
  });

  it("配置文档不存在时返回未发布", async () => {
    const get = vi.fn().mockRejectedValue({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document not found",
    });
    const { collection } = collectionWithDocument({ get });
    const repository = new CloudBaseBootstrapConfigRepository(collection);

    await expect(repository.find()).resolves.toBeUndefined();
  });
});

describe("CloudBaseCloudSaveRepository", () => {
  const set = vi.fn((value: unknown) => ({ $set: value }));
  const databaseCommand = { set } as CloudBaseCommand;
  const command = {
    playerId: "player-1",
    baseRevision: 1,
    clientVersion: "3.4.2",
    clientSavedAt: 190,
    serverSavedAt: 200,
    idempotencyKey: "request-key-0001",
    requestHash: "request-hash",
    hash: "save-hash",
    sizeBytes: 128,
    save: {
      version: "3.4.2",
      serialized: 1 as const,
      time: 190,
      modules: { user: { level: 2 } },
    },
  };

  it("以 playerId 和 baseRevision 条件更新，确保并发写入只有一个成功", async () => {
    set.mockClear();
    const get = vi.fn().mockResolvedValue({
      requestId: "get-1",
      data: [{
        revision: 1,
        clientVersion: "3.4.1",
        clientSavedAt: 100,
        serverSavedAt: 110,
        hash: "old-hash",
        sizeBytes: 64,
        save: { version: "3.4.1", serialized: 1, time: 100, modules: { user: { level: 1 } } },
        lastIdempotencyKey: "old-request",
        lastRequestHash: "old-request-hash",
      }],
    });
    const update = vi.fn().mockResolvedValue({ requestId: "update-1", updated: 1 });
    const where = vi.fn(() => ({ get: vi.fn(), update }));
    const collection = { doc: vi.fn(() => ({ get })), add: vi.fn(), where } as unknown as CloudBaseCollectionReference;
    const repository = new CloudBaseCloudSaveRepository(collection, databaseCommand);

    await expect(repository.compareAndSet(command)).resolves.toMatchObject({
      status: "saved",
      record: { revision: 2, previous: { revision: 1, hash: "old-hash" } },
    });
    expect(where).toHaveBeenCalledWith({ _id: "player-1", revision: 1 });
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(command.save);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      save: { $set: command.save },
    }));
    expect(set).toHaveBeenNthCalledWith(2, expect.objectContaining({ revision: 1 }));
  });

  it("条件更新失败后读取并返回冲突，不覆盖新版本", async () => {
    const oldDocument = {
      revision: 1,
      clientVersion: "3.4.1",
      clientSavedAt: 100,
      serverSavedAt: 110,
      hash: "old-hash",
      sizeBytes: 64,
      save: { version: "3.4.1", serialized: 1, time: 100, modules: { user: { level: 1 } } },
      lastIdempotencyKey: "old-request",
      lastRequestHash: "old-request-hash",
    };
    const newDocument = { ...oldDocument, revision: 2, hash: "other-device-hash" };
    const get = vi.fn()
      .mockResolvedValueOnce({ requestId: "get-before", data: [oldDocument] })
      .mockResolvedValueOnce({ requestId: "get-after", data: [newDocument] });
    const update = vi.fn().mockResolvedValue({ requestId: "update-0", updated: 0 });
    const collection = {
      doc: vi.fn(() => ({ get })),
      add: vi.fn(),
      where: vi.fn(() => ({ get: vi.fn(), update })),
    } as unknown as CloudBaseCollectionReference;
    const repository = new CloudBaseCloudSaveRepository(collection, databaseCommand);

    await expect(repository.compareAndSet(command)).resolves.toMatchObject({
      status: "conflict",
      current: { revision: 2, hash: "other-device-hash" },
    });
  });
});
