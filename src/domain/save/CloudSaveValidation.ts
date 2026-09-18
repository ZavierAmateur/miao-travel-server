import { createHash } from "node:crypto";
import type { CloudSavePayload, JsonValue } from "./CloudSave.js";
import { CloudSaveValidationError } from "./CloudSaveErrors.js";

export const MAX_SAVE_BYTES = 512 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
export const V1_CLOUD_SAVE_MODULES = ["user"] as const;
export const V1_CLOUD_PLAYER_FIELDS = [
  "saveTime",
  "undoCount",
  "refreshCount",
  "bombCount",
  "winnerStreakCount",
  "todaySuccessCount",
  "animals",
  "todayVideoForEnergyCount",
  "sevenSignProgress",
  "sevenSignTodayState",
  "refreshAnimalId",
  "todayAnimalId",
  "levelMaxProgress",
  "subscribeStae",
  "adFreeCount",
  "level",
  "energy",
  "energyTimer",
  "energyInfinite",
  "gold",
  "star",
  "totalRechargeAmount",
  "totalGoodBuyCounts",
  "todayGoodBuyCounts",
  "todayGoodsBuyTime",
  "firstSevenAwardGot",
  "myMiniProgramDaily",
  "desktopDaily",
  "todayAdReliveCount",
] as const;
const LEGACY_ALLOWED_MODULES = new Set(["settings", "tutorial", "user", "task", "activitys"]);
const V1_CLOUD_PLAYER_FIELD_SET = new Set<string>(V1_CLOUD_PLAYER_FIELDS);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export interface PutCloudSaveInput {
  readonly baseRevision: number;
  readonly clientVersion: string;
  readonly clientSavedAt: number;
  readonly save: unknown;
  readonly idempotencyKey: string;
}

export interface ValidatedCloudSaveInput extends Omit<PutCloudSaveInput, "save"> {
  readonly save: CloudSavePayload;
  readonly hash: string;
  readonly requestHash: string;
  readonly sizeBytes: number;
}

export function validateCloudSaveInput(input: PutCloudSaveInput): ValidatedCloudSaveInput {
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw invalid("baseRevision 必须是非负安全整数");
  }
  if (typeof input.clientVersion !== "string" || input.clientVersion.length < 1 || input.clientVersion.length > 64) {
    throw invalid("clientVersion 长度必须为 1-64");
  }
  if (!Number.isSafeInteger(input.clientSavedAt) || input.clientSavedAt < 0) {
    throw invalid("clientSavedAt 必须是非负安全整数");
  }
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw invalid("idempotencyKey 长度必须为 8-128");
  }

  const save = validatePayload(input.save);
  const inputSizeBytes = Buffer.byteLength(stableStringify(input.save), "utf8");
  if (inputSizeBytes > MAX_SAVE_BYTES) {
    throw new CloudSaveValidationError("SAVE_TOO_LARGE", `云存档不得超过 ${MAX_SAVE_BYTES} 字节`);
  }
  const canonicalSave = stableStringify(save);
  const sizeBytes = Buffer.byteLength(canonicalSave, "utf8");
  const hash = sha256(canonicalSave);
  const requestHash = sha256(stableStringify({
    baseRevision: input.baseRevision,
    clientVersion: input.clientVersion,
    clientSavedAt: input.clientSavedAt,
    saveHash: hash,
  }));
  return { ...input, save, hash, requestHash, sizeBytes };
}

function validatePayload(value: unknown): CloudSavePayload {
  if (!isPlainObject(value)) throw invalid("save 必须是对象");
  if (typeof value.version !== "string" || value.version.length < 1 || value.version.length > 64) {
    throw invalid("save.version 长度必须为 1-64");
  }
  if (value.serialized !== 1) throw invalid("save.serialized 必须为 1");
  if (!Number.isSafeInteger(value.time) || (value.time as number) < 0) {
    throw invalid("save.time 必须是非负安全整数");
  }
  if (!isPlainObject(value.modules)) throw invalid("save.modules 必须是对象");
  const moduleNames = Object.keys(value.modules);
  if (moduleNames.length < 1) throw invalid("save.modules 不能为空");
  for (const moduleName of moduleNames) {
    if (!LEGACY_ALLOWED_MODULES.has(moduleName)) throw invalid(`不允许的存档模块：${moduleName}`);
  }
  if (!isPlainObject(value.modules.user)) throw invalid("V1 云存档必须包含 user 对象");

  const counter = { value: 0 };
  validateJsonValue(value.modules, 0, counter);
  // 兼容旧客户端传入五模块，但服务端只持久化 V1 产品范围内的 user。
  return normalizeV1CloudSavePayload({
    version: value.version,
    serialized: 1,
    time: value.time as number,
    modules: { user: value.modules.user },
  });
}

/**
 * 把完成安全校验的客户端 user 收口为 V1 字段白名单。
 * 未列入白名单的字段会被忽略，避免旧客户端或旧文档把废弃字段重新带回云端。
 */
function normalizeV1CloudSavePayload(value: CloudSavePayload): CloudSavePayload {
  const user = value.modules.user;
  const normalizedUser: Record<string, JsonValue> = {};
  if (isPlainObject(user)) {
    for (const [key, item] of Object.entries(user)) {
      if (V1_CLOUD_PLAYER_FIELD_SET.has(key)) normalizedUser[key] = item;
    }
  }
  return {
    version: value.version,
    serialized: 1,
    time: value.time,
    modules: { user: normalizedUser },
  };
}

function validateJsonValue(value: unknown, depth: number, counter: { value: number }): asserts value is JsonValue {
  counter.value += 1;
  if (counter.value > MAX_NODES) throw invalid("云存档节点数量过多");
  if (depth > MAX_DEPTH) throw invalid("云存档嵌套层级过深");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid("云存档包含非法数值");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, depth + 1, counter);
    return;
  }
  if (!isPlainObject(value)) throw invalid("云存档只能包含 JSON 数据");
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw invalid(`云存档包含危险字段：${key}`);
    validateJsonValue(item, depth + 1, counter);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw invalid("云存档包含无法序列化的数据");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function invalid(message: string): CloudSaveValidationError {
  return new CloudSaveValidationError("INVALID_SAVE", message);
}
