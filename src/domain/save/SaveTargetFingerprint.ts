import {createHash} from "node:crypto";
/** 不包含凭据；用于把清档健康检查绑定到同一持久化目标。 */
export function saveTargetFingerprint(config: {readonly cloudbaseEnvId: string; readonly cloudbaseDatabaseInstance: string; readonly cloudDatabaseName: string}): string {
  return createHash("sha256").update(JSON.stringify([config.cloudbaseEnvId, config.cloudbaseDatabaseInstance, config.cloudDatabaseName])).digest("hex");
}
