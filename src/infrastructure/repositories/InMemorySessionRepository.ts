import type { Session } from "../../domain/session/Session.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  save(session: Session): Promise<void> {
    this.sessions.set(session.tokenHash, session);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    return Promise.resolve(this.sessions.get(tokenHash));
  }
}
