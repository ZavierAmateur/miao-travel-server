import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { CosStorageConfig } from "../../config/CosStorageConfig.js";
import { AdminPermission } from "../admin/AdminAccess.js";
import type { AdminAuthService } from "../admin/AdminAuthService.js";
import type { AdminAuditRepository } from "../admin/AdminRepositories.js";
import { AdminFileError } from "./AdminFileErrors.js";
import type { FileStorage } from "./FileStorage.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface AdminFileServiceOptions {
  readonly auth: AdminAuthService;
  readonly audits: AdminAuditRepository;
  readonly storage?: FileStorage;
  readonly storageConfig: CosStorageConfig;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class AdminFileService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly options: AdminFileServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async upload(token: string | undefined, input: {
    readonly filename: string;
    readonly body: Buffer;
  }, context: { readonly requestId: string; readonly ip: string }) {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(AdminPermission.ConfigWrite)) {
      throw new AdminFileError("ADMIN_PERMISSION_DENIED", "无权上传文件", 403);
    }
    if (!this.options.storageConfig.enabled || !this.options.storage) {
      throw new AdminFileError("FILE_STORAGE_UNAVAILABLE", "文件存储尚未配置", 503);
    }
    if (input.body.length === 0) throw new AdminFileError("EMPTY_FILE", "上传文件不能为空", 400);
    if (input.body.length > MAX_UPLOAD_BYTES) throw new AdminFileError("FILE_TOO_LARGE", "上传文件不能超过 5MB", 413);
    const detected = detectImage(input.body);
    if (!detected) throw new AdminFileError("UNSUPPORTED_FILE_TYPE", "仅支持 JPEG、PNG、WebP 图片", 400);

    const fileId = this.createId();
    const date = new Date(this.now());
    const objectKey = `uploads/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${fileId}.${detected.extension}`;
    try {
      await this.options.storage.upload({ objectKey, body: input.body, contentType: detected.contentType });
    } catch {
      throw new AdminFileError("FILE_UPLOAD_FAILED", "文件上传失败，请稍后重试", 502);
    }
    const url = `${this.options.storageConfig.publicBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
    await this.options.audits.append({
      id: randomUUID(),
      adminUserId: identity.id,
      action: "file.upload",
      requestId: context.requestId,
      ip: context.ip,
      createdAt: this.now(),
      metadata: { fileId, objectKey, contentType: detected.contentType, sizeBytes: input.body.length },
    });
    return {
      fileId,
      objectKey,
      url,
      originalName: basename(input.filename).slice(0, 255),
      contentType: detected.contentType,
      sizeBytes: input.body.length,
    };
  }
}

function detectImage(buffer: Buffer): { readonly contentType: string; readonly extension: string } | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", extension: "png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  return undefined;
}
