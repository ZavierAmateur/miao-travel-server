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
