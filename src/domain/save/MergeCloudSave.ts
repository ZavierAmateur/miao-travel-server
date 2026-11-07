import {createHash} from "node:crypto";
import type {CloudSavePayload, JsonValue, PutCloudSaveCommand} from "./CloudSave.js";
import {CloudSaveValidationError} from "./CloudSaveErrors.js";
import {MAX_SAVE_BYTES, stableStringify} from "./CloudSaveValidation.js";

/** 客户端字段已经过白名单校验；只让这些显式字段覆盖，服务端原有资产保留。
 * 在仓储读取当前 revision 之后、同一 revision CAS 写入之前调用。
 * requestHash 保持客户端请求摘要，确保重试不会因合并后的文档而改变幂等身份。
 */
export function mergeStoredCloudSave(command: PutCloudSaveCommand, stored?: CloudSavePayload): PutCloudSaveCommand {
  if (!stored || stored.generation !== command.save.generation) return command;
  const oldUser = stored.modules.user;
  const newUser = command.save.modules.user;
  const save: CloudSavePayload = {
    ...stored, ...command.save,
    modules: {...stored.modules, ...command.save.modules,
      user: {...(isObject(oldUser) ? oldUser : {}), ...(isObject(newUser) ? newUser : {})}},
  };
  const canonical = stableStringify(save), sizeBytes = Buffer.byteLength(canonical, "utf8");
  if (sizeBytes > MAX_SAVE_BYTES) throw new CloudSaveValidationError("SAVE_TOO_LARGE", "合并已有资产后的云存档超过容量限制，未写入");
  return {...command, save, sizeBytes, hash: createHash("sha256").update(canonical).digest("hex")};
}
function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
