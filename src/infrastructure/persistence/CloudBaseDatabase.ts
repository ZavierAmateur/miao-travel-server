export interface CloudBaseResult {
  readonly requestId: string;
  readonly code?: string;
  readonly message?: string;
}

export interface CloudBaseGetResult extends CloudBaseResult {
  readonly data: unknown[];
}

export interface CloudBaseCountResult extends CloudBaseResult {
  readonly total: number;
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
  count(): Promise<CloudBaseCountResult>;
  get(): Promise<CloudBaseGetResult>;
  update(data: object): Promise<CloudBaseUpdateResult>;
  limit(count: number): CloudBaseQueryReference;
  skip(offset: number): CloudBaseQueryReference;
  orderBy(field: string, orderType: "desc" | "asc"): CloudBaseQueryReference;
}

export interface CloudBaseAggregateReference {
  match(query: object): CloudBaseAggregateReference;
  bucket(options: { readonly groupBy: string; readonly boundaries: readonly string[]; readonly output: object }): CloudBaseAggregateReference;
  end(): Promise<CloudBaseGetResult>;
}

export interface CloudBaseCollectionReference {
  aggregate(): CloudBaseAggregateReference;
  doc(id: string): CloudBaseDocumentReference;
  add(data: object): Promise<CloudBaseResult>;
  where(query: object): CloudBaseQueryReference;
}

export interface CloudBaseDatabase {
  readonly command: CloudBaseCommand & {
    lt(value: string | number): unknown;
  };
  RegExp(options: { readonly regexp: string; readonly options?: string }): unknown;
  collection(name: string): CloudBaseCollectionReference;
  createCollection?(name: string): Promise<CloudBaseResult>;
}
