import { authenticateSession } from "../auth/SessionAuthenticator.js";
import type { SessionRepository } from "../session/SessionRepository.js";
import type { PutPlayerProfileInput } from "./PlayerProfile.js";
import type { PlayerProfileRepository } from "./PlayerProfileRepository.js";
import { validatePlayerProfile } from "./PlayerProfileValidation.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";

export interface PlayerProfileServiceOptions {
  readonly sessions: SessionRepository;
  readonly profiles: PlayerProfileRepository;
  readonly players?: PlayerRepository;
  readonly now?: () => number;
}

export class PlayerProfileService {
  private readonly now: () => number;

  constructor(private readonly options: PlayerProfileServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(authorization?: string) {
    const playerId = await authenticateSession(this.options.sessions, authorization, this.now, this.options.players);
    const profile = await this.options.profiles.findByPlayerId(playerId);
    if (!profile) {
      return { exists: false, nickName: "", avatarUrl: "", updatedAt: 0 } as const;
    }
    return {
      exists: true,
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: profile.updatedAt,
    } as const;
  }

  async put(authorization: string | undefined, input: PutPlayerProfileInput) {
    const playerId = await authenticateSession(this.options.sessions, authorization, this.now, this.options.players);
    const profile = await this.options.profiles.save({
      playerId,
      ...validatePlayerProfile(input),
      updatedAt: this.now(),
    });
    return {
      nickName: profile.nickName,
      avatarUrl: profile.avatarUrl,
      updatedAt: profile.updatedAt,
    } as const;
  }
}
