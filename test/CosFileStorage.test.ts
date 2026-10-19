import { describe, expect, it, vi } from "vitest";
import type COS from "cos-nodejs-sdk-v5";
import type { CosStorageConfig } from "../src/config/CosStorageConfig.js";
import { CosFileStorage } from "../src/infrastructure/storage/CosFileStorage.js";

const config: CosStorageConfig = {
  enabled: true, secretId: "test-id", secretKey: "test-key", bucket: "miao-1487859276",
  region: "ap-guangzhou", publicBaseUrl: "https://cdn.sujiegame.com",
};
const objectKey = "admin/uploads/海报_20261019_id.webp";
const ready = { ETag: "etag", headers: { "content-type": "image/webp", "content-length": "123" } };

function setup() {
  const client = {
    putObject: vi.fn<COS["putObject"]>().mockResolvedValue({ ETag: "source-etag", Location: "source-location" }),
    headObject: vi.fn<COS["headObject"]>().mockResolvedValue(ready),
  };
  const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
  return { client, wait, storage: new CosFileStorage(config, client, wait) };
}

describe("COS 原图上传与工作流输出确认", () => {
  it("上传保持原图字节和 MIME，不伪装成 WebP", async () => {
    const { client, storage } = setup();
    const body = Buffer.from("source-image");
    await storage.upload({ objectKey: "admin/uploads/海报_20261019_id.png", body, contentType: "image/png" });
    expect(client.putObject).toHaveBeenCalledWith({
      Bucket: config.bucket, Region: config.region, Key: "admin/uploads/海报_20261019_id.png",
      Body: body, ContentLength: body.length, ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    });
    expect(client.headObject).not.toHaveBeenCalled();
  });

  it("工作流已生成时直接读取输出对象的真实元数据", async () => {
    const { client, wait, storage } = setup();
    expect(await storage.waitForObject(objectKey)).toEqual({ contentType: "image/webp", sizeBytes: 123 });
    expect(client.headObject).toHaveBeenCalledWith({ Bucket: config.bucket, Region: config.region, Key: objectKey });
    expect(wait).not.toHaveBeenCalled();
  });

  it("仅针对尚未生成的 404 等待后再次确认", async () => {
    const { client, wait, storage } = setup();
    client.headObject.mockRejectedValueOnce({ statusCode: 404 });
    expect(await storage.waitForObject(objectKey)).toEqual({ contentType: "image/webp", sizeBytes: 123 });
    expect(client.headObject).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it("超过确认次数仍未生成则停止等待", async () => {
    const { client, wait, storage } = setup();
    client.headObject.mockRejectedValue({ statusCode: 404 });
    await expect(storage.waitForObject(objectKey)).rejects.toThrow("COS workflow output is not available");
    expect(client.headObject).toHaveBeenCalledTimes(20);
    expect(wait).toHaveBeenCalledTimes(19);
  });

  it("权限错误立即失败，不作为工作流排队重试", async () => {
    const { client, wait, storage } = setup();
    const error = { statusCode: 403 };
    client.headObject.mockRejectedValue(error);
    await expect(storage.waitForObject(objectKey)).rejects.toBe(error);
    expect(wait).not.toHaveBeenCalled();
  });

  it("不把缺失的对象大小当作可用结果", async () => {
    const { client, storage } = setup();
    client.headObject.mockResolvedValue({ ETag: "etag", headers: { "content-type": "image/webp" } });
    await expect(storage.waitForObject(objectKey)).rejects.toThrow("COS object metadata is invalid");
  });
});
