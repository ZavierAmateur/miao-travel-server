import { createHash } from "node:crypto";
import type { SessionRepository } from "../session/SessionRepository.js";
import type { CloudSaveRepository } from "./CloudSaveRepository.js";
import { CloudSaveConflictError, SessionAuthenticationError } from "./CloudSaveErrors.js";
import { validateCloudSaveInput, type PutCloudSaveInput } from "./CloudSaveValidation.js";

export interface CloudSaveServiceOptions {
  readonly sessions: SessionRepository;
  readonly saves: CloudSaveRepository;
  readonly now?: () => number;
}

export class CloudSaveService {
  private readonly now: () => number;

  constructor(private readonly options: CloudSaveServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async get(authorization?: string) {
    const playerId = await this.authenticate(authorization);
    const record = await this.options.saves.findByPlayerId(playerId);
    if (!record) return { exists: false, revision: 0, serverSavedAt: 0, save: null } as const;
    return {
      exists: true,
      revision: record.revision,
      serverSavedAt: record.serverSavedAt,
      hash: record.hash,
      save: record.save,
    } as const;
  }

  async put(authorization: string | undefined, input: PutCloudSaveInput) {
    const playerId = await this.authenticate(authorization);
    const validated = validateCloudSaveInput(input);
    const result = await this.options.saves.compareAndSet({
      playerId,
      ...validated,
      serverSavedAt: this.now(),
    });
    if (result.status === "conflict") {
      const current = result.current;
      throw new CloudSaveConflictError(current ? {
        revision: current.revision,
        serverSavedAt: current.serverSavedAt,
        hash: current.hash,
      } : undefined);
    }
    return {
      revision: result.record.revision,
      serverSavedAt: result.record.serverSavedAt,
      hash: result.record.hash,
      duplicate: result.status === "duplicate",
    };
  }

  private async authenticate(authorization?: string): Promise<string> {
    const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
    if (!match) throw new SessionAuthenticationError("AUTH_REQUIRED", "缺少登录凭证");
    const tokenHash = createHash("sha256").update(match[1]!).digest("hex");
    const session = await this.options.sessions.findByTokenHash(tokenHash);
    if (!session || session.revokedAt !== undefined) {
      throw new SessionAuthenticationError("SESSION_INVALID", "登录凭证无效");
    }
    if (session.expiresAt <= this.now()) {
      throw new SessionAuthenticationError("SESSION_EXPIRED", "登录凭证已过期");
    }
    return session.playerId;
  }
}
