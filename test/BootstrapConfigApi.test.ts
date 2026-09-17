import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { BootstrapConfigService } from "../src/domain/config/BootstrapConfigService.js";
import { InMemoryBootstrapConfigRepository } from "../src/infrastructure/repositories/InMemoryBootstrapConfigRepository.js";

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

describe("GET /v1/bootstrap-config", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("缺少云端文档时返回允许游戏和云存档的安全默认值", async () => {
    const app = buildApp({
      config,
      bootstrapConfigService: new BootstrapConfigService(new InMemoryBootstrapConfigRepository()),
      now: () => 2_000,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/bootstrap-config" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    const body = response.json<{ requestId: string } & Record<string, unknown>>();
    expect(typeof body.requestId).toBe("string");
    expect({ ...body, requestId: "<requestId>" }).toEqual({
      code: 0,
      msg: "ok",
      timestamp: 2_000,
      requestId: "<requestId>",
      data: {
        configRevision: 0,
        maintenance: { enabled: false, message: "" },
        minimumClientVersion: "",
        features: { cloudSaveEnabled: true },
        cacheTtlSeconds: 300,
      },
    });
  });

  it("返回持久化开关且匹配 ETag 时响应 304", async () => {
    const repository = new InMemoryBootstrapConfigRepository({
      revision: 7,
      maintenanceEnabled: true,
      maintenanceMessage: "云服务维护中，本地游戏不受影响",
      minimumClientVersion: "3.4.2",
      cloudSaveEnabled: false,
      updatedAt: 1_000,
      updatedBy: "acceptance",
    });
    const app = buildApp({
      config,
      bootstrapConfigService: new BootstrapConfigService(repository),
      now: () => 2_000,
    });
    apps.push(app);

    const first = await app.inject({ method: "GET", url: "/v1/bootstrap-config" });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ data: object }>().data).toEqual({
      configRevision: 7,
      maintenance: { enabled: true, message: "云服务维护中，本地游戏不受影响" },
      minimumClientVersion: "3.4.2",
      features: { cloudSaveEnabled: false },
      cacheTtlSeconds: 300,
    });

    const second = await app.inject({
      method: "GET",
      url: "/v1/bootstrap-config",
      headers: { "if-none-match": first.headers.etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });
});
