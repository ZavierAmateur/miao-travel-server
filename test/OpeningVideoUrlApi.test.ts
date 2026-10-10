import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { SessionAuthenticationError } from "../src/domain/save/CloudSaveErrors.js";

const config: AppConfig = {
  environment: AppEnvironment.Test,
  host: "127.0.0.1",
  port: 3000,
  platform: PlatformKind.WeChat,
  appId: "test-app",
  appSecret: "test-secret",
  logLevel: "error",
  persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "",
  cloudbaseRegion: "",
  cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "",
  cloudDatabaseName: "",
};

describe("opening video URL API", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("只向已登录玩家返回不可缓存的临时地址", async () => {
    const get = vi.fn((authorization?: string) => {
      if (authorization !== "Bearer player-session") {
        return Promise.reject(new SessionAuthenticationError("AUTH_REQUIRED", "缺少登录凭证"));
      }
      return Promise.resolve({ url: "https://temporary.example/video.mp4", issuedAt: 1_789_520_000_000 });
    });
    app = buildApp({
      config,
      openingVideoUrlService: { get },
      now: () => 1_789_520_000_000,
    });

    const unauthorized = await app.inject({ method: "GET", url: "/v1/opening-video-url" });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/v1/opening-video-url",
      headers: { authorization: "Bearer player-session" },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.headers["cache-control"]).toBe("private, no-store");
    const body = authorized.json<{ data: { url: string } }>();
    expect(body.data.url).toBe("https://temporary.example/video.mp4");
    expect(get).toHaveBeenCalledWith("Bearer player-session");
  });
});
