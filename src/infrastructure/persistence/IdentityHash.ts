import { createHash } from "node:crypto";
import type { PlatformIdentity } from "../../domain/player/PlayerRepository.js";

/**
 * 使用不可逆键定位平台身份，数据库和索引中都不保存明文 openid。
 * JSON 数组编码避免简单字符串拼接产生边界碰撞。
 */
export function hashPlatformIdentity(identity: PlatformIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.platform, identity.appId, identity.openId]))
    .digest("hex");
}

export function hashOptionalIdentifier(identifier: string | undefined): string | undefined {
  if (!identifier) return undefined;
  return createHash("sha256").update(identifier).digest("hex");
}
