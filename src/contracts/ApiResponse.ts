export interface ApiSuccess<T> {
  readonly code: 0;
  readonly msg: "ok";
  readonly timestamp: number;
  readonly requestId: string;
  readonly data: T;
}

export interface ApiFailure {
  readonly code: string;
  readonly msg: string;
  readonly timestamp: number;
  readonly requestId: string;
}

export function success<T>(requestId: string, data: T, timestamp = Date.now()): ApiSuccess<T> {
  return { code: 0, msg: "ok", timestamp, requestId, data };
}
