import { authenticateSession } from "../auth/SessionAuthenticator.js";
import type { PlayerRepository } from "../player/PlayerRepository.js";
import type { SessionRepository } from "../session/SessionRepository.js";

export interface OpeningVideoUrlSigner {
  getTemporaryUrl(fileId: string): Promise<string>;
}

export interface OpeningVideoUrlServiceOptions {
  readonly sessions: SessionRepository;
  readonly players: PlayerRepository;
  readonly signer: OpeningVideoUrlSigner;
  readonly fileId: string;
  readonly now?: () => number;
}

/** 登录玩家通过游戏后端换取私有 CloudBase 视频的短期播放地址。 */
export class OpeningVideoUrlService {
  private readonly now: () => number;

  constructor(private readonly options: OpeningVideoUrlServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(authorization?: string): Promise<{ url: string; issuedAt: number }> {
    await authenticateSession(
      this.options.sessions,
      authorization,
      this.now,
      this.options.players,
    );
    const url = await this.options.signer.getTemporaryUrl(this.options.fileId);
    return { url, issuedAt: this.now() };
  }
}
