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
  publicBaseUrl: "https://miao-1487859276.cos.ap-guangzhou.myqcloud.com",
};

class RecordingStorage implements FileStorage {
  uploads: FileStorageUpload[] = [];
  upload(input: FileStorageUpload): Promise<void> { this.uploads.push(input); return Promise.resolve(); }
}

describe("通用文件上传 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;
  let storage: RecordingStorage;

  beforeEach(async () => {
    const audits = new InMemoryAdminAuditRepository();
    const auth = new AdminAuthService({
      users: new InMemoryAdminUserRepository(), sessions: new InMemoryAdminSessionRepository(), audits,
      now: () => Date.UTC(2026, 8, 21), createToken: () => "file-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    storage = new RecordingStorage();
    const files = new AdminFileService({
      auth, audits, storage, storageConfig, now: () => Date.UTC(2026, 8, 21), createId: () => "file-id-1",
    });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, adminFileService: files, now: () => Date.UTC(2026, 8, 21) });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("校验 PNG 文件头后上传并返回可保存的文件信息", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const multipart = createMultipart("file", "海报.png", "image/png", png);
    const response = await app!.inject({
      method: "POST", url: "/admin/v1/files/upload", headers: { cookie, "content-type": multipart.contentType }, payload: multipart.body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: {
      fileId: "file-id-1",
      objectKey: "uploads/2026/09/file-id-1.png",
      url: "https://miao-1487859276.cos.ap-guangzhou.myqcloud.com/uploads/2026/09/file-id-1.png",
      originalName: "海报.png",
      contentType: "image/png",
      sizeBytes: png.length,
    } });
    expect(storage.uploads).toEqual([expect.objectContaining({ contentType: "image/png", objectKey: "uploads/2026/09/file-id-1.png" })]);
  });

  it("拒绝伪装图片和未登录上传", async () => {
    const fake = createMultipart("file", "bad.png", "image/png", Buffer.from("not-an-image"));
    const invalid = await app!.inject({ method: "POST", url: "/admin/v1/files/upload", headers: { cookie, "content-type": fake.contentType }, payload: fake.body });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });

    const png = createMultipart("file", "ok.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const anonymous = await app!.inject({ method: "POST", url: "/admin/v1/files/upload", headers: { "content-type": png.contentType }, payload: png.body });
    expect(anonymous.statusCode).toBe(401);
  });
});

function createMultipart(field: string, filename: string, contentType: string, file: Buffer) {
  const boundary = "----miao-test-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([head, file, tail]) };
}
