import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";

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

describe("HTTP app", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("返回带 requestId 的健康检查响应", async () => {
    app = buildApp({ config, now: () => 1_789_520_000_000 });
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "test-request-id" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      code: 0,
      msg: "ok",
      timestamp: 1_789_520_000_000,
      requestId: "test-request-id",
      data: {
        status: "ok",
        service: "miao-travel-server",
        version: "0.1.0",
        environment: "test",
        platform: "wechat",
        persistence: "memory",
      },
    });
  });

  it("为未知接口返回统一错误结构", async () => {
    app = buildApp({ config, now: () => 1_789_520_000_000 });
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: "ROUTE_NOT_FOUND",
      msg: "接口不存在",
      timestamp: 1_789_520_000_000,
    });
    expect(response.body).toMatch(/"requestId":"[^"]+"/);
  });
});
