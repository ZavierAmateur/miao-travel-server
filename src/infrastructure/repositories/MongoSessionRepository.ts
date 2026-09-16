import type { Collection } from "mongodb";
import type { Session } from "../../domain/session/Session.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";

export interface MongoSessionDocument {
  readonly _id: string;
  readonly playerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly expiresAtDate: Date;
  readonly revokedAt?: number;
}

export class MongoSessionRepository implements SessionRepository {
  constructor(private readonly collection: Collection<MongoSessionDocument>) {}

  async save(session: Session): Promise<void> {
    await this.collection.updateOne(
      { _id: session.tokenHash },
      {
        $set: {
          playerId: session.playerId,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          expiresAtDate: new Date(session.expiresAt),
          ...(session.revokedAt === undefined ? {} : { revokedAt: session.revokedAt }),
        },
      },
      { upsert: true },
    );
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const document = await this.collection.findOne({ _id: tokenHash });
    if (!document) return undefined;
    return {
      tokenHash: document._id,
      playerId: document.playerId,
      createdAt: document.createdAt,
      expiresAt: document.expiresAt,
      ...(document.revokedAt === undefined ? {} : { revokedAt: document.revokedAt }),
    };
  }
}
