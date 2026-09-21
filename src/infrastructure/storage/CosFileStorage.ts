import COS from "cos-nodejs-sdk-v5";
import type { CosStorageConfig } from "../../config/CosStorageConfig.js";
import type { FileStorage, FileStorageUpload } from "../../domain/file/FileStorage.js";

type CosUploader = Pick<COS, "putObject">;

export class CosFileStorage implements FileStorage {
  private readonly client: CosUploader;

  constructor(
    private readonly config: CosStorageConfig,
    client?: CosUploader,
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
}
