export interface FileStorageUpload {
  readonly objectKey: string;
  readonly body: Buffer;
  readonly contentType: string;
}

export interface FileStorage {
  upload(input: FileStorageUpload): Promise<void>;
}
