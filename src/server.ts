import { AdminProjectSettingsService } from "./domain/config/AdminProjectSettingsService.js";
import { CAMPAIGN_SAVE_POLICY } from "./domain/save/CampaignSavePolicy.js";
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
import { LeaderboardSyncService } from "./domain/leaderboard/LeaderboardSyncService.js";
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
  requiredGeneration: CAMPAIGN_SAVE_POLICY.generation,
  requiredProgressVersion: CAMPAIGN_SAVE_POLICY.progressVersion,
  leaderboard: persistence.levelLeaderboard,
  players: persistence.players,
  profiles: persistence.profiles,
});
const leaderboardSync = new LeaderboardSyncService({
  saves: persistence.saves,
  profiles: persistence.profiles,
  projector: levelLeaderboardProjector,
  onError: failure => app.log.warn(failure, "排行榜同步失败，保留待同步标记"),
});
const cloudSaveService = new CloudSaveService({
  requiredGeneration: CAMPAIGN_SAVE_POLICY.generation,
  requiredProgressVersion: CAMPAIGN_SAVE_POLICY.progressVersion,
  firstPlayableLevel: CAMPAIGN_SAVE_POLICY.firstPlayableLevel,
  sessions: persistence.sessions,
  saves: persistence.saves,
  players: persistence.players,
  leaderboardSync,
});
const bootstrapConfigService = new BootstrapConfigService(persistence.bootstrapConfigs);
const playerProfileService = new PlayerProfileService({
  sessions: persistence.sessions,
  profiles: persistence.profiles,
  players: persistence.players,
  leaderboardSync,
});
const adminAuthConfig = loadAdminAuthConfig();
const adminAuthService = adminAuthConfig.enabled
  ? new AdminAuthService({
      users: persistence.adminUsers,
      sessions: persistence.adminSessions,
      audits: persistence.adminAudits,
    })
  : undefined;
const adminProjectSettingsService = adminAuthService
  ? new AdminProjectSettingsService({ auth: adminAuthService, repository: persistence.bootstrapConfigs, audits: persistence.adminAudits })
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
      leaderboardSync,
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
  ...(adminProjectSettingsService ? { adminProjectSettingsService } : {}),
  ...(adminPlayerService ? { adminPlayerService } : {}),
  ...(adminLeaderboardService ? { adminLeaderboardService } : {}),
  ...(adminFileService ? { adminFileService } : {}),
});

app.addHook("onReady", done => { leaderboardSync.start(); done(); });
app.addHook("onClose", async () => { await leaderboardSync.stop(); });

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
