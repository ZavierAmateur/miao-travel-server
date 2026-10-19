import COS from "cos-nodejs-sdk-v5";
import { setTimeout } from "node:timers/promises";
import type { CosStorageConfig } from "../../config/CosStorageConfig.js";
import type { FileStorage, FileStorageMetadata, FileStorageUpload } from "../../domain/file/FileStorage.js";

type CosUploader = Pick<COS, "putObject" | "headObject">;

export class CosFileStorage implements FileStorage {
  private readonly client: CosUploader;

  constructor(
    private readonly config: CosStorageConfig,
    client?: CosUploader,
    private readonly wait: (milliseconds: number) => Promise<void> = setTimeout,
  ) {
    this.client = client ?? new COS({ SecretId: config.secretId, SecretKey: config.secretKey });
  }

  async upload(input: FileStorageUpload): Promise<void> {
    await this.client.putObject({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: input.objectKey,
      Body: input.body,
      ContentLength: input.body.length,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    });
  }

  async waitForObject(objectKey: string): Promise<FileStorageMetadata> {
    // Check COS directly so an in-progress workflow cannot create a cached CDN 404.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const result = await this.client.headObject({ Bucket: this.config.bucket, Region: this.config.region, Key: objectKey });
        const sizeBytes = Number(result.headers?.["content-length"]);
        const contentType: unknown = result.headers?.["content-type"];
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || typeof contentType !== "string" || !contentType) {
          throw new Error("COS object metadata is invalid");
        }
        return { contentType, sizeBytes };
      } catch (error) {
        if (typeof error !== "object" || error === null || !("statusCode" in error) || error.statusCode !== 404) throw error;
      }
      if (attempt < 19) await this.wait(1000);
    }
    throw new Error("COS workflow output is not available");
  }
}
