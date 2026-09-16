export interface CloudBaseResult {
  readonly requestId: string;
  readonly code?: string;
  readonly message?: string;
}

export interface CloudBaseGetResult extends CloudBaseResult {
  readonly data: unknown[];
}

export interface CloudBaseDocumentReference {
  get(): Promise<CloudBaseGetResult>;
  set(data: object): Promise<CloudBaseResult>;
  remove(): Promise<CloudBaseResult>;
}

export interface CloudBaseCollectionReference {
  doc(id: string): CloudBaseDocumentReference;
}

export interface CloudBaseDatabase {
  collection(name: string): CloudBaseCollectionReference;
  createCollection?(name: string): Promise<CloudBaseResult>;
}
