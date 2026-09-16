import type { Session } from "./Session.js";

export interface SessionRepository {
  save(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | undefined>;
}
