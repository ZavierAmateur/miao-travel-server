import cloudbase from "@cloudbase/js-sdk";
import { PersistenceDriver, type AppConfig } from "../../config/AppConfig.js";
import type { PlayerRepository } from "../../domain/player/PlayerRepository.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";
import type { CloudSaveRepository } from "../../domain/save/CloudSaveRepository.js";
import { InMemoryPlayerRepository } from "../repositories/InMemoryPlayerRepository.js";
import { InMemorySessionRepository } from "../repositories/InMemorySessionRepository.js";
import { InMemoryCloudSaveRepository } from "../repositories/InMemoryCloudSaveRepository.js";
import type { CloudBaseDatabase } from "./CloudBaseDatabase.js";
import { CloudBasePlayerRepository } from "../repositories/CloudBasePlayerRepository.js";
import { CloudBaseSessionRepository } from "../repositories/CloudBaseSessionRepository.js";
import { CloudBaseCloudSaveRepository } from "../repositories/CloudBaseCloudSaveRepository.js";
import type { BootstrapConfigRepository } from "../../domain/config/BootstrapConfigRepository.js";
import { InMemoryBootstrapConfigRepository } from "../repositories/InMemoryBootstrapConfigRepository.js";
import { CloudBaseBootstrapConfigRepository } from "../repositories/CloudBaseBootstrapConfigRepository.js";
import type { PlayerProfileRepository } from "../../domain/profile/PlayerProfileRepository.js";
import { InMemoryPlayerProfileRepository } from "../repositories/InMemoryPlayerProfileRepository.js";
import { CloudBasePlayerProfileRepository } from "../repositories/CloudBasePlayerProfileRepository.js";

export interface Persistence {
  readonly players: PlayerRepository;
  readonly sessions: SessionRepository;
  readonly saves: CloudSaveRepository;
  readonly bootstrapConfigs: BootstrapConfigRepository;
  readonly profiles: PlayerProfileRepository;
  close(): Promise<void>;
}

export function createPersistence(config: AppConfig): Promise<Persistence> {
  if (config.persistenceDriver === PersistenceDriver.Memory) {
    return Promise.resolve({
      players: new InMemoryPlayerRepository(),
      sessions: new InMemorySessionRepository(),
      saves: new InMemoryCloudSaveRepository(),
      bootstrapConfigs: new InMemoryBootstrapConfigRepository(),
      profiles: new InMemoryPlayerProfileRepository(),
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
    saves: new CloudBaseCloudSaveRepository(database.collection("cloud_saves"), database.command),
    bootstrapConfigs: new CloudBaseBootstrapConfigRepository(database.collection("remote_configs")),
    profiles: new CloudBasePlayerProfileRepository(database.collection("player_profiles")),
    close: () => Promise.resolve(),
  });
}
