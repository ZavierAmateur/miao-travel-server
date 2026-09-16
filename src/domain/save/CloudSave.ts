export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CloudSavePayload {
  readonly version: string;
  readonly serialized: 0 | 1;
  readonly time: number;
  readonly modules: Record<string, JsonValue>;
}

export interface CloudSaveSnapshot {
  readonly revision: number;
  readonly clientVersion: string;
  readonly clientSavedAt: number;
  readonly serverSavedAt: number;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly save: CloudSavePayload;
}

export interface CloudSaveRecord extends CloudSaveSnapshot {
  readonly playerId: string;
  readonly lastIdempotencyKey: string;
  readonly lastRequestHash: string;
  readonly previous?: CloudSaveSnapshot;
}

export interface PutCloudSaveCommand {
  readonly playerId: string;
  readonly baseRevision: number;
  readonly clientVersion: string;
  readonly clientSavedAt: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly save: CloudSavePayload;
  readonly serverSavedAt: number;
}

export type PutCloudSaveResult =
  | { readonly status: "saved" | "duplicate"; readonly record: CloudSaveRecord }
  | { readonly status: "conflict"; readonly current?: CloudSaveRecord };
