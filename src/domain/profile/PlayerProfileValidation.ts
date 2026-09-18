import type { PutPlayerProfileInput } from "./PlayerProfile.js";
import { PlayerProfileValidationError } from "./PlayerProfileErrors.js";

const MAX_NICK_NAME_CHARACTERS = 32;
const MAX_AVATAR_URL_LENGTH = 2_048;

export function validatePlayerProfile(input: PutPlayerProfileInput): PutPlayerProfileInput {
  if (typeof input.nickName !== "string") throw invalid("nickName 必须是字符串");
  const nickName = input.nickName.trim();
  const nickNameLength = Array.from(nickName).length;
  if (nickNameLength < 1 || nickNameLength > MAX_NICK_NAME_CHARACTERS) {
    throw invalid(`nickName 长度必须为 1-${MAX_NICK_NAME_CHARACTERS} 个字符`);
  }
  if (Array.from(nickName).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  })) throw invalid("nickName 包含非法控制字符");

  if (typeof input.avatarUrl !== "string" || input.avatarUrl.length > MAX_AVATAR_URL_LENGTH) {
    throw invalid(`avatarUrl 长度不得超过 ${MAX_AVATAR_URL_LENGTH}`);
  }
  const avatarUrl = input.avatarUrl.trim();
  if (avatarUrl) {
    let parsed: URL;
    try {
      parsed = new URL(avatarUrl);
    } catch {
      throw invalid("avatarUrl 不是有效 URL");
    }
    if (parsed.protocol !== "https:") throw invalid("avatarUrl 必须使用 HTTPS");
  }
  return { nickName, avatarUrl };
}

function invalid(message: string): PlayerProfileValidationError {
  return new PlayerProfileValidationError(message);
}
