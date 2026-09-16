export interface CloudBaseResult {
  readonly requestId: string;
  readonly code?: string;
  readonly message?: string;
}

export interface CloudBaseGetResult extends CloudBaseResult {
  readonly data: unknown[];
}

export interface CloudBaseUpdateResult extends CloudBaseResult {
  readonly updated: number;
}

export interface CloudBaseDocumentReference {
  get(): Promise<CloudBaseGetResult>;
  set(data: object): Promise<CloudBaseResult>;
  remove(): Promise<CloudBaseResult>;
}

export interface CloudBaseQueryReference {
  get(): Promise<CloudBaseGetResult>;
  update(data: object): Promise<CloudBaseUpdateResult>;
}

export interface CloudBaseCollectionReference {
  doc(id: string): CloudBaseDocumentReference;
  add(data: object): Promise<CloudBaseResult>;
  where(query: object): CloudBaseQueryReference;
}

export interface CloudBaseDatabase {
  collection(name: string): CloudBaseCollectionReference;
  createCollection?(name: string): Promise<CloudBaseResult>;
}
