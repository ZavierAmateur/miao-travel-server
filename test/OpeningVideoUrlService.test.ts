import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import { PlayerStatus } from "../src/domain/player/Player.js";
import { SessionAuthenticationError } from "../src/domain/save/CloudSaveErrors.js";
import { OpeningVideoUrlService } from "../src/domain/video/OpeningVideoUrlService.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../src/infrastructure/repositories/InMemorySessionRepository.js";

const token = "opening-video-session";
const fileId = "cloud://example/video/game_video.mp4";
const now = 2_000;

describe("OpeningVideoUrlService", () => {
  let sessions: InMemorySessionRepository;
  let players: InMemoryPlayerRepository;

  beforeEach(async () => {
    sessions = new InMemorySessionRepository();
    players = new InMemoryPlayerRepository();
    await players.save({
      id: "player-1",
      platform: PlatformKind.WeChat,
      appId: "test-app",
      platformOpenId: "openid-1",
      status: PlayerStatus.Active,
      createdAt: 1_000,
      lastLoginAt: 1_000,
    });
    await sessions.save({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      playerId: "player-1",
      createdAt: 1_000,
      expiresAt: 10_000,
    });
  });

  it("鉴权成功后才由服务端签发固定视频地址", async () => {
    const getTemporaryUrl = vi.fn(() => Promise.resolve("https://temporary.example/video.mp4"));
    const service = new OpeningVideoUrlService({
      sessions,
      players,
      signer: { getTemporaryUrl },
      fileId,
      now: () => now,
    });

    await expect(service.get(`Bearer ${token}`)).resolves.toEqual({
      url: "https://temporary.example/video.mp4",
      issuedAt: now,
    });
    expect(getTemporaryUrl).toHaveBeenCalledOnce();
    expect(getTemporaryUrl).toHaveBeenCalledWith(fileId);
  });

  it("未登录请求不会触发私有文件签名", async () => {
    const getTemporaryUrl = vi.fn(() => Promise.resolve("https://temporary.example/video.mp4"));
    const service = new OpeningVideoUrlService({
      sessions,
      players,
      signer: { getTemporaryUrl },
      fileId,
      now: () => now,
    });

    await expect(service.get()).rejects.toBeInstanceOf(SessionAuthenticationError);
    expect(getTemporaryUrl).not.toHaveBeenCalled();
  });
});
