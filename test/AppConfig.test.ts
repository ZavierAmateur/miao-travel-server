import { describe, expect, it } from "vitest";
import {
  AppEnvironment,
  ConfigValidationError,
  PersistenceDriver,
  PlatformKind,
  assertPersistenceReady,
  loadConfig,
} from "../src/config/AppConfig.js";

describe("loadConfig", () => {
  it("为开发环境提供安全默认值", () => {
    const config = loadConfig({});
    expect(config.environment).toBe(AppEnvironment.Development);
    expect(config.platform).toBe(PlatformKind.WeChat);
    expect(config.port).toBe(3000);
    expect(config.appSecret).toBe("");
    expect(config.persistenceDriver).toBe(PersistenceDriver.Memory);
  });

  it("拒绝生产环境缺少平台密钥", () => {
    expect(() => loadConfig({ NODE_ENV: "production", PLATFORM: "wechat" }))
      .toThrow(ConfigValidationError);
  });

  it("拒绝无效端口和未知平台", () => {
    expect(() => loadConfig({ PORT: "70000", PLATFORM: "unknown" }))
      .toThrow(/PORT.*PLATFORM/);
  });

  it("拒绝生产环境使用内存仓储", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      PLATFORM: "wechat",
      APP_ID: "production-app",
      APP_SECRET: "production-secret",
    });
    expect(() => assertPersistenceReady(config))
      .toThrow(/生产环境禁止使用内存仓储/);
  });

  it("拒绝 CloudBase HTTP 持久化缺少连接配置", () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: "cloudbase-http" }))
      .toThrow(/CLOUDBASE_ENV_ID.*CLOUDBASE_REGION.*CLOUDBASE_API_KEY.*CLOUDBASE_DATABASE_INSTANCE.*CLOUDBASE_DATABASE_NAME/);
  });

  it("接受完整的 CloudBase HTTP 持久化配置", () => {
    const config = loadConfig({
      PERSISTENCE_DRIVER: "cloudbase-http",
      CLOUDBASE_ENV_ID: "cloud1-example",
      CLOUDBASE_REGION: "ap-shanghai",
      CLOUDBASE_API_KEY: "server-api-key",
      CLOUDBASE_DATABASE_INSTANCE: "(default)",
      CLOUDBASE_DATABASE_NAME: "(default)",
    });
    expect(config.persistenceDriver).toBe(PersistenceDriver.CloudBaseHttp);
    expect(config.cloudbaseEnvId).toBe("cloud1-example");
    expect(config.cloudDatabaseName).toBe("(default)");
  });
});
