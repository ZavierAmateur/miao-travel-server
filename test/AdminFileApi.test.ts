import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import type { CosStorageConfig } from "../src/config/CosStorageConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AdminFileService } from "../src/domain/file/AdminFileService.js";
import type { FileStorage, FileStorageUpload } from "../src/domain/file/FileStorage.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";

const config: AppConfig = {
  environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "test-app", appSecret: "test-secret",
  logLevel: "error", persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "", cloudbaseRegion: "", cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "", cloudDatabaseName: "",
};
const adminConfig: AdminAuthConfig = {
  enabled: true, bootstrapAccount: "root.admin", bootstrapPassword: "correct-password-123",
  bootstrapDisplayName: "超级管理员", webOrigin: "http://127.0.0.1:5173", secureCookie: false,
};
const storageConfig: CosStorageConfig = {
  enabled: true, secretId: "secret-id", secretKey: "secret-key",
  bucket: "miao-1487859276", region: "ap-guangzhou",
  publicBaseUrl: "https://cdn.sujiegame.com",
};

class RecordingStorage implements FileStorage {
  uploads: FileStorageUpload[] = [];
  checkedKeys: string[] = [];
  upload(input: FileStorageUpload): Promise<void> { this.uploads.push(input); return Promise.resolve(); }
  waitForObject(objectKey: string) {
    this.checkedKeys.push(objectKey);
    return Promise.resolve({ contentType: "image/webp", sizeBytes: 100 });
  }
}

describe("通用文件上传 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;
  let storage: RecordingStorage;
  let uploadTime: number;

  beforeEach(async () => {
    const audits = new InMemoryAdminAuditRepository();
    const auth = new AdminAuthService({
      users: new InMemoryAdminUserRepository(), sessions: new InMemoryAdminSessionRepository(), audits,
      now: () => Date.UTC(2026, 8, 21), createToken: () => "file-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    storage = new RecordingStorage();
    uploadTime = Date.UTC(2026, 9, 18, 16);
    let sequence = 0;
    const files = new AdminFileService({
      auth, audits, storage, storageConfig,
      now: () => uploadTime, createId: () => `file-id-${++sequence}`,
    });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, adminFileService: files, now: () => Date.UTC(2026, 8, 21) });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it.each([
    ["png", "png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    ["jpeg", "jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 1])],
    ["webp", "webp", "image/webp", Buffer.from("RIFF0000WEBPdata")],
  ] as const)("%s 原图原样上传，公告引用桶工作流输出的 WebP", async (extension, sourceExtension, contentType, image) => {
    const response = await upload(`海报.${extension}`, contentType, image);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: {
      fileId: "file-id-1",
      objectKey: "admin/uploads/海报_20261019_file-id-1.webp",
      url: "https://cdn.sujiegame.com/admin/uploads/%E6%B5%B7%E6%8A%A5_20261019_file-id-1.webp",
      originalName: `海报.${extension}`,
      contentType: "image/webp",
      sizeBytes: sourceExtension === "webp" ? image.length : 100,
    } });
    expect(storage.uploads).toEqual([{
      objectKey: `admin/uploads/海报_20261019_file-id-1.${sourceExtension}`, body: image, contentType,
    }]);
    expect(storage.checkedKeys).toEqual(sourceExtension === "webp" ? [] : ["admin/uploads/海报_20261019_file-id-1.webp"]);
  });

  it("同名图片每次生成新 URL，日期使用北京时间", async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    uploadTime = Date.UTC(2026, 11, 31, 15, 59, 59);
    await upload("活动.png", "image/png", image);
    uploadTime += 1000;
    await upload("活动.png", "image/png", image);
    expect(storage.checkedKeys).toEqual([
      "admin/uploads/活动_20261231_file-id-1.webp",
      "admin/uploads/活动_20270101_file-id-2.webp",
    ]);
  });

  it("工作流输出未就绪时不返回成功的 WebP 链接", async () => {
    storage.waitForObject = () => Promise.reject(new Error("workflow not ready"));
    const response = await upload("海报.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "FILE_PROCESSING_FAILED" });
    expect(storage.uploads).toHaveLength(1);
  });

  it("存储失败返回上传错误，不伪造成功 URL", async () => {
    storage.upload = () => Promise.reject(new Error("COS unavailable"));
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const response = await upload("海报.png", "image/png", image);
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: "FILE_UPLOAD_FAILED" });
  });

  function upload(filename: string, contentType: string, body: Buffer) {
    const multipart = createMultipart("file", filename, contentType, body);
    return app!.inject({
      method: "POST", url: "/admin/v1/files/upload", headers: { cookie, "content-type": multipart.contentType }, payload: multipart.body,
    });
  }

  it("拒绝伪装图片和未登录上传", async () => {
    const fake = createMultipart("file", "bad.png", "image/png", Buffer.from("not-an-image"));
    const invalid = await app!.inject({ method: "POST", url: "/admin/v1/files/upload", headers: { cookie, "content-type": fake.contentType }, payload: fake.body });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });

    const png = createMultipart("file", "ok.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const anonymous = await app!.inject({ method: "POST", url: "/admin/v1/files/upload", headers: { "content-type": png.contentType }, payload: png.body });
    expect(anonymous.statusCode).toBe(401);
    expect(storage.uploads).toHaveLength(0);
  });
});

function createMultipart(field: string, filename: string, contentType: string, file: Buffer) {
  const boundary = "----miao-test-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([head, file, tail]) };
}
