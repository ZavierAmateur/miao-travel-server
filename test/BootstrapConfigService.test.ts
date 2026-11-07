import { describe, expect, it } from "vitest";
import { BootstrapConfigService } from "../src/domain/config/BootstrapConfigService.js";
import { InMemoryBootstrapConfigRepository } from "../src/infrastructure/repositories/InMemoryBootstrapConfigRepository.js";

describe("BootstrapConfigService", () => {
  it("同一配置生成稳定 ETag，内部审计字段不暴露给客户端", async () => {
    const repository = new InMemoryBootstrapConfigRepository({
      revision: 3,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minimumClientVersion: "3.4.2",
      cloudSaveEnabled: true,
      updatedAt: 1_000,
      updatedBy: "operator@example",
    });
    const service = new BootstrapConfigService(repository);

    const first = await service.get();
    const second = await service.get();

    expect(first.etag).toBe(second.etag);
    expect(first.data).not.toHaveProperty("updatedAt");
    expect(first.data).not.toHaveProperty("updatedBy");
  });

  it("拒绝数据库中的非法配置而不是静默启用未知值", async () => {
    const repository = new InMemoryBootstrapConfigRepository({
      revision: 1,
      maintenanceEnabled: false,
      maintenanceMessage: "",
      minimumClientVersion: "",
      cloudSaveEnabled: "yes" as unknown as boolean,
      updatedAt: 1_000,
      updatedBy: "test",
    });

    await expect(new BootstrapConfigService(repository).get()).rejects.toThrow("cloudSaveEnabled");
  });
});

// 客户端发行规则不按体验版/正式版分叉，老文档无 latest 字段仍可读取。
describe("统一客户端版本规则", () => {
  it("默认兼容老文档，并将最新版本加入响应和ETag", async () => {
    const repo = new InMemoryBootstrapConfigRepository({ revision: 8, maintenanceEnabled: false,
      maintenanceMessage: "", minimumClientVersion: "1.2.0", cloudSaveEnabled: true,
      updatedAt: 1, updatedBy: "test" });
    const service = new BootstrapConfigService(repo);
    const old = await service.get();
    expect(old.data).toHaveProperty("latestClientVersion", "");
    await repo.save({ ...(await repo.find())!, latestClientVersion: "1.3.0" });
    const next = await service.get();
    expect(next.data).toHaveProperty("latestClientVersion", "1.3.0");
    expect(next.etag).not.toBe(old.etag);
  });
  it("拒绝非法版本及最低高于最新的发布规则", async () => {
    const { validateBootstrapConfigRecord, DEFAULT_BOOTSTRAP_CONFIG } = await import("../src/domain/config/BootstrapConfig.js");
    for (const value of [
      { minimumClientVersion: "1.2.bad" },
      { latestClientVersion: "1.3.0-beta" },
      { minimumClientVersion: "1.4.0", latestClientVersion: "1.3.0" },
    ]) expect(() => validateBootstrapConfigRecord({ ...DEFAULT_BOOTSTRAP_CONFIG, ...value })).toThrow(/版本|Version/);
  });
});
