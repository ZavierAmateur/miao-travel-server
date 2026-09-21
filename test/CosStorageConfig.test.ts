import { describe, expect, it } from "vitest";
import { CosStorageConfigError, loadCosStorageConfig } from "../src/config/CosStorageConfig.js";

describe("COS 配置", () => {
  it("完全未配置时保持关闭，不阻塞服务启动", () => {
    expect(loadCosStorageConfig({})).toMatchObject({ enabled: false });
  });

  it("拒绝只配置部分密钥", () => {
    expect(() => loadCosStorageConfig({ COS_BUCKET: "miao-1487859276" })).toThrow(CosStorageConfigError);
  });

  it("未指定公开域名时生成 COS HTTPS 默认域名", () => {
    expect(loadCosStorageConfig({
      COS_SECRET_ID: "secret-id", COS_SECRET_KEY: "secret-key",
      COS_BUCKET: "miao-1487859276", COS_REGION: "ap-guangzhou",
    })).toMatchObject({
      enabled: true,
      publicBaseUrl: "https://miao-1487859276.cos.ap-guangzhou.myqcloud.com",
    });
  });
});
