import { createHash } from "node:crypto";
import type { SessionRepository } from "../session/SessionRepository.js";
import { SessionAuthenticationError } from "../save/CloudSaveErrors.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import { isPlayerBanActive } from "../player/Player.js";

/** 统一校验玩家 Bearer 会话，避免各业务接口复制鉴权规则。 */
export async function authenticateSession(
  sessions: SessionRepository,
  authorization?: string,
  now: () => number = Date.now,
  players?: PlayerRepository,
): Promise<string> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  if (!match) throw new SessionAuthenticationError("AUTH_REQUIRED", "缺少登录凭证");
  const tokenHash = createHash("sha256").update(match[1]!).digest("hex");
  const session = await sessions.findByTokenHash(tokenHash);
  if (!session || session.revokedAt !== undefined) {
    throw new SessionAuthenticationError("SESSION_INVALID", "登录凭证无效");
  }
  if (session.expiresAt <= now()) {
    throw new SessionAuthenticationError("SESSION_EXPIRED", "登录凭证已过期");
  }
  if (players) {
    const player = await players.findById(session.playerId);
    if (player && isPlayerBanActive(player, now())) {
      throw new SessionAuthenticationError("PLAYER_BANNED", player.banReason || "账号已被封禁");
    }
    if (player?.status === "banned" && player.banExpiresAt && player.banExpiresAt <= now()) {
      await players.updateAdminState(player.id, { status: "active" });
    }
  }
  return session.playerId;
}
