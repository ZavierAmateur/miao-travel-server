export interface FileStorageUpload {
  readonly objectKey: string;
  readonly body: Buffer;
  readonly contentType: string;
}

export interface FileStorageMetadata {
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface FileStorage {
  upload(input: FileStorageUpload): Promise<void>;
  waitForObject(objectKey: string): Promise<FileStorageMetadata>;
}
