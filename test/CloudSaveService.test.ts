import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionAuthenticationError } from "../src/domain/save/CloudSaveErrors.js";
import { CloudSaveService } from "../src/domain/save/CloudSaveService.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";

const token = "cloud-save-session-token";
const now = 2_000;

function input(baseRevision = 0, idempotencyKey = "request-key-0001") {
  return {
    baseRevision,
    clientVersion: "3.4.2",
    clientSavedAt: 1_900,
    idempotencyKey,
    save: {
      version: "3.4.2",
      serialized: 1,
      time: 1_900,
      modules: { user: { level: 4 } },
    },
  } as const;
}

describe("CloudSaveService", () => {
  let sessions: InMemorySessionRepository;
  let saves: InMemoryCloudSaveRepository;
  let service: CloudSaveService;

  beforeEach(async () => {
    sessions = new InMemorySessionRepository();
    saves = new InMemoryCloudSaveRepository();
    service = new CloudSaveService({ sessions, saves, now: () => now });
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-1",
      createdAt: 1_000,
      expiresAt: 10_000,
    });
  });

  it("首次保存创建 revision 1 并可读取", async () => {
    await expect(service.put(`Bearer ${token}`, input())).resolves.toMatchObject({
      revision: 1,
      serverSavedAt: now,
      duplicate: false,
    });
    await expect(service.get(`Bearer ${token}`)).resolves.toMatchObject({
      exists: true,
      revision: 1,
      save: { modules: { user: { level: 4 } } },
    });
  });

  it("相同幂等键和请求只返回既有结果，不重复递增版本", async () => {
    const first = await service.put(`Bearer ${token}`, input());
    const second = await service.put(`Bearer ${token}`, input());
    expect(second).toEqual({ ...first, duplicate: true });
  });

  it("旧 baseRevision 写入返回冲突且保留云端摘要", async () => {
    await service.put(`Bearer ${token}`, input());
    await expect(service.put(`Bearer ${token}`, input(0, "request-key-0002"))).rejects.toMatchObject({
      current: { revision: 1, serverSavedAt: now },
    });
  });

  it("无效或过期会话无法读写", async () => {
    await expect(service.get("Bearer invalid")).rejects.toBeInstanceOf(SessionAuthenticationError);
    await sessions.save({
      tokenHash: createHash("sha256").update("expired").digest("hex"),
      playerId: "player-1",
      createdAt: 1,
      expiresAt: now,
    });
    await expect(service.put("Bearer expired", input())).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });
});
