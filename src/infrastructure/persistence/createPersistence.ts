import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, type AppConfig } from "../../config/AppConfig.js";
import type { PlayerRepository } from "../../domain/player/PlayerRepository.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";
import { InMemoryPlayerRepository } from "../repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../repositories/InMemorySessionRepository.js";
import type { CloudBaseDatabase } from "./CloudBaseDatabase.js";
import { CloudBasePlayerRepository } from "../repositories/CloudBasePlayerRepository.js";
import { CloudBaseSessionRepository } from "../repositories/CloudBaseSessionRepository.js";

export interface Persistence {
  readonly players: PlayerRepository;
  readonly sessions: SessionRepository;
  close(): Promise<void>;
}

export function createPersistence(config: AppConfig): Promise<Persistence> {
  if (config.persistenceDriver === PersistenceDriver.Memory) {
    return Promise.resolve({
      players: new InMemoryPlayerRepository(),
      sessions: new InMemorySessionRepository(),
      close: () => Promise.resolve(),
    });
  }

  const app = cloudbase.init({
    env: config.cloudbaseEnvId,
    region: config.cloudbaseRegion,
    accessKey: config.cloudbaseApiKey,
    timeout: 5_000,
  });
  const database = app.database({
    instance: config.cloudbaseDatabaseInstance,
    database: config.cloudDatabaseName,
  }) as CloudBaseDatabase;
  return Promise.resolve({
    players: new CloudBasePlayerRepository(database.collection("players")),
    sessions: new CloudBaseSessionRepository(database.collection("sessions")),
    close: () => Promise.resolve(),
  });
}
