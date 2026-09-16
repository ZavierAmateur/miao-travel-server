import { MongoClient } from "mongodb";
import { PersistenceDriver, type AppConfig } from "../../config/AppConfig.js";
import type { PlayerRepository } from "../../domain/player/PlayerRepository.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";
import { InMemoryPlayerRepository } from "../repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../repositories/InMemorySessionRepository.js";
import { MongoPlayerRepository, type MongoPlayerDocument } from "../repositories/MongoPlayerRepository.js";
import { MongoSessionRepository, type MongoSessionDocument } from "../repositories/MongoSessionRepository.js";

export interface Persistence {
  readonly players: PlayerRepository;
  readonly sessions: SessionRepository;
  close(): Promise<void>;
}

export async function createPersistence(config: AppConfig): Promise<Persistence> {
  if (config.persistenceDriver === PersistenceDriver.Memory) {
    return {
      players: new InMemoryPlayerRepository(),
      sessions: new InMemorySessionRepository(),
      close: () => Promise.resolve(),
    };
  }

  const client = new MongoClient(config.cloudDatabaseUri, {
    appName: "miao-travel-server",
    minPoolSize: 0,
    maxPoolSize: 5,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 5_000,
  });
  try {
    await client.connect();
    const database = client.db(config.cloudDatabaseName);
    await database.command({ ping: 1 });
    const players = database.collection<MongoPlayerDocument>("players");
    const sessions = database.collection<MongoSessionDocument>("sessions");
    await Promise.all([
      players.createIndex({ id: 1 }, { unique: true, name: "uq_players_id" }),
      players.createIndex({ platform: 1, status: 1, lastLoginAt: -1 }, { name: "ix_players_admin" }),
      sessions.createIndex({ playerId: 1, expiresAt: -1 }, { name: "ix_sessions_player" }),
      sessions.createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0, name: "ttl_sessions_expiry" }),
    ]);
    return {
      players: new MongoPlayerRepository(players),
      sessions: new MongoSessionRepository(sessions),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
