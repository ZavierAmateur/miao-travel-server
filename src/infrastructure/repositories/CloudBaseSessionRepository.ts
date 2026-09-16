import type { Session } from "../../domain/session/Session.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

export interface CloudBaseSessionDocument {
  readonly _id?: string;
  readonly playerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
}

export class CloudBaseSessionRepository implements SessionRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

  async save(session: Session): Promise<void> {
    await this.collection.doc(session.tokenHash).set({
      playerId: session.playerId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ...(session.revokedAt === undefined ? {} : { revokedAt: session.revokedAt }),
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    try {
      const result = await this.collection.doc(tokenHash).get();
      const document = result.data[0] as CloudBaseSessionDocument | undefined;
      if (!document) return undefined;
      return {
        tokenHash,
        playerId: document.playerId,
        createdAt: document.createdAt,
        expiresAt: document.expiresAt,
        ...(document.revokedAt === undefined ? {} : { revokedAt: document.revokedAt }),
      };
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }
}
