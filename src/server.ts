import { buildApp } from "./app.js";
import { assertPersistenceReady, loadConfig } from "./config/AppConfig.js";
import { PlatformLoginService } from "./domain/auth/PlatformLoginService.js";
import { CloudSaveService } from "./domain/save/CloudSaveService.js";
import { createPersistence } from "./infrastructure/persistence/createPersistence.js";
import { createPlatformAuthGateway } from "./platform/createPlatformAuthGateway.js";
import { BootstrapConfigService } from "./domain/config/BootstrapConfigService.js";
import { PlayerProfileService } from "./domain/profile/PlayerProfileService.js";
import { loadAdminAuthConfig } from "./config/AdminAuthConfig.js";
import { AdminAuthService } from "./domain/admin/AdminAuthService.js";
import { AdminPlayerService } from "./domain/admin/AdminPlayerService.js";
import { AdminErrorLogService } from "./domain/admin/AdminErrorLogService.js";
import { AnnouncementService } from "./domain/announcement/AnnouncementService.js";
import { loadCosStorageConfig } from "./config/CosStorageConfig.js";
import { AdminFileService } from "./domain/file/AdminFileService.js";
import { CosFileStorage } from "./infrastructure/storage/CosFileStorage.js";
import { LevelLeaderboardProjector } from "./domain/leaderboard/LevelLeaderboardProjector.js";
import { AdminLeaderboardService } from "./domain/leaderboard/AdminLeaderboardService.js";

const config = loadConfig();
assertPersistenceReady(config);
const persistence = await createPersistence(config);
const platformLoginService = new PlatformLoginService({
  config,
  gateway: createPlatformAuthGateway(config),
  players: persistence.players,
  sessions: persistence.sessions,
});
const levelLeaderboardProjector = new LevelLeaderboardProjector({
  leaderboard: persistence.levelLeaderboard,
  players: persistence.players,
  profiles: persistence.profiles,
});
const cloudSaveService = new CloudSaveService({
  sessions: persistence.sessions,
  saves: persistence.saves,
  players: persistence.players,
  leaderboard: levelLeaderboardProjector,
});
const bootstrapConfigService = new BootstrapConfigService(persistence.bootstrapConfigs);
const playerProfileService = new PlayerProfileService({
  sessions: persistence.sessions,
  profiles: persistence.profiles,
  players: persistence.players,
  leaderboard: levelLeaderboardProjector,
});
const adminAuthConfig = loadAdminAuthConfig();
const adminAuthService = adminAuthConfig.enabled
  ? new AdminAuthService({
      users: persistence.adminUsers,
      sessions: persistence.adminSessions,
      audits: persistence.adminAudits,
    })
  : undefined;
const adminLeaderboardService = adminAuthService
  ? new AdminLeaderboardService({ auth: adminAuthService, leaderboard: persistence.levelLeaderboard })
  : undefined;
if (adminAuthService) {
  await adminAuthService.ensureBootstrapAdmin(
    adminAuthConfig.bootstrapAccount,
    adminAuthConfig.bootstrapPassword,
    adminAuthConfig.bootstrapDisplayName,
  );
}
const adminPlayerService = adminAuthService
  ? new AdminPlayerService({
      auth: adminAuthService,
      players: persistence.players,
      profiles: persistence.profiles,
      saves: persistence.saves,
      audits: persistence.adminAudits,
      leaderboard: levelLeaderboardProjector,
    })
  : undefined;
const adminErrorLogService = adminAuthService
  ? new AdminErrorLogService({
      auth: adminAuthService,
      logs: persistence.adminErrorLogs,
    })
  : undefined;
const announcementService = new AnnouncementService({
  repository: persistence.announcements,
  ...(adminAuthService ? { auth: adminAuthService, audits: persistence.adminAudits } : {}),
});
const cosStorageConfig = loadCosStorageConfig();
const adminFileService = adminAuthService
  ? new AdminFileService({
      auth: adminAuthService,
      audits: persistence.adminAudits,
      storageConfig: cosStorageConfig,
      ...(cosStorageConfig.enabled ? { storage: new CosFileStorage(cosStorageConfig) } : {}),
    })
  : undefined;
const app = buildApp({
  config,
  platformLoginService,
  cloudSaveService,
  bootstrapConfigService,
  playerProfileService,
  announcementService,
  ...(adminAuthService && adminErrorLogService ? { adminAuthService, adminAuthConfig, adminErrorLogService } : {}),
  ...(adminPlayerService ? { adminPlayerService } : {}),
  ...(adminLeaderboardService ? { adminLeaderboardService } : {}),
  ...(adminFileService ? { adminFileService } : {}),
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "开始优雅关闭服务");
  try {
    await app.close();
  } finally {
    await persistence.close();
  }
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "服务启动失败");
  await persistence.close();
  process.exitCode = 1;
}
