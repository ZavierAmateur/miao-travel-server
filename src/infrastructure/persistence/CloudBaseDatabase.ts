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

export interface CloudBaseCommand {
  set(value: unknown): unknown;
}

export interface CloudBaseDocumentReference {
  get(): Promise<CloudBaseGetResult>;
  set(data: object): Promise<CloudBaseResult>;
  remove(): Promise<CloudBaseResult>;
}

export interface CloudBaseQueryReference {
  get(): Promise<CloudBaseGetResult>;
  update(data: object): Promise<CloudBaseUpdateResult>;
  limit(count: number): CloudBaseQueryReference;
  skip(offset: number): CloudBaseQueryReference;
  orderBy(field: string, orderType: "desc" | "asc"): CloudBaseQueryReference;
}

export interface CloudBaseCollectionReference {
  doc(id: string): CloudBaseDocumentReference;
  add(data: object): Promise<CloudBaseResult>;
  where(query: object): CloudBaseQueryReference;
}

export interface CloudBaseDatabase {
  readonly command: CloudBaseCommand;
  collection(name: string): CloudBaseCollectionReference;
  createCollection?(name: string): Promise<CloudBaseResult>;
}
