export const AppEnvironment = Object.freeze({
  Development: "development",
  Test: "test",
  Production: "production",
} as const);

export type AppEnvironment = typeof AppEnvironment[keyof typeof AppEnvironment];

export const PlatformKind = Object.freeze({
  WeChat: "wechat",
  ByteDance: "bytedance",
} as const);

export type PlatformKind = typeof PlatformKind[keyof typeof PlatformKind];

export const PersistenceDriver = Object.freeze({
  Memory: "memory",
  Mongo: "mongo",
} as const);

export type PersistenceDriver = typeof PersistenceDriver[keyof typeof PersistenceDriver];

export interface AppConfig {
  readonly environment: AppEnvironment;
  readonly host: string;
  readonly port: number;
  readonly platform: PlatformKind;
  readonly appId: string;
  readonly appSecret: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly persistenceDriver: PersistenceDriver;
  readonly cloudDatabaseUri: string;
  readonly cloudDatabaseName: string;
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`环境配置无效：${issues.join("；")}`);
    this.name = "ConfigValidationError";
  }
}

const environments = new Set<string>(Object.values(AppEnvironment));
const platforms = new Set<string>(Object.values(PlatformKind));
const logLevels = new Set<string>(["debug", "info", "warn", "error"]);
const persistenceDrivers = new Set<string>(Object.values(PersistenceDriver));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const issues: string[] = [];
  const environment = env.NODE_ENV ?? AppEnvironment.Development;
  const host = env.HOST?.trim() || "0.0.0.0";
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  const platform = env.PLATFORM ?? PlatformKind.WeChat;
  const appId = env.APP_ID?.trim() ?? "";
  const appSecret = env.APP_SECRET?.trim() ?? "";
  const logLevel = env.LOG_LEVEL ?? "info";
  const persistenceDriver = env.PERSISTENCE_DRIVER ?? PersistenceDriver.Memory;
  const cloudDatabaseUri = env.CLOUD_DATABASE_URI?.trim() ?? "";
  const cloudDatabaseName = env.CLOUD_DATABASE_NAME?.trim() ?? "";

  if (!environments.has(environment)) issues.push(`NODE_ENV 不支持：${environment}`);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) issues.push(`PORT 必须是 1-65535 的整数：${rawPort}`);
  if (!platforms.has(platform)) issues.push(`PLATFORM 不支持：${platform}`);
  if (!logLevels.has(logLevel)) issues.push(`LOG_LEVEL 不支持：${logLevel}`);
  if (!persistenceDrivers.has(persistenceDriver)) issues.push(`PERSISTENCE_DRIVER 不支持：${persistenceDriver}`);
  if (environment === AppEnvironment.Production && !appId) issues.push("生产环境必须配置 APP_ID");
  if (environment === AppEnvironment.Production && !appSecret) issues.push("生产环境必须配置 APP_SECRET");
  if (persistenceDriver === PersistenceDriver.Mongo && !cloudDatabaseUri) {
    issues.push("Mongo 持久化必须配置 CLOUD_DATABASE_URI");
  }
  if (persistenceDriver === PersistenceDriver.Mongo && !cloudDatabaseName) {
    issues.push("Mongo 持久化必须配置 CLOUD_DATABASE_NAME");
  }

  if (issues.length > 0) throw new ConfigValidationError(issues);

  return {
    environment: environment as AppEnvironment,
    host,
    port,
    platform: platform as PlatformKind,
    appId,
    appSecret,
    logLevel: logLevel as AppConfig["logLevel"],
    persistenceDriver: persistenceDriver as PersistenceDriver,
    cloudDatabaseUri,
    cloudDatabaseName,
  };
}

/** 防止把仅供开发的内存仓储误部署到生产环境。 */
export function assertPersistenceReady(config: AppConfig): void {
  if (config.environment === AppEnvironment.Production && config.persistenceDriver === PersistenceDriver.Memory) {
    throw new ConfigValidationError(["生产环境禁止使用内存仓储，请先完成云数据库适配"]);
  }
}
