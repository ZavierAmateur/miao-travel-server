import {mkdir, open, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import cloudbase from "@cloudbase/js-sdk";
import {PersistenceDriver, assertPersistenceReady, loadConfig} from "../src/config/AppConfig.js";
import {CAMPAIGN_SAVE_POLICY} from "../src/domain/save/CampaignSavePolicy.js";
import {resetCampaignProgress} from "../src/domain/save/ProgressOnlyReset.js";
import {saveTargetFingerprint} from "../src/domain/save/SaveTargetFingerprint.js";
import type {CloudBaseDatabase} from "../src/infrastructure/persistence/CloudBaseDatabase.js";

// 默认 dry-run。备份包含游戏资产，目录/文件仅当前用户可读；不打印配置或密钥。
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("Usage: reset-campaign-progress.ts --backup-dir=/absolute/new-directory [--health-url=https://host/health] [--apply]\nDefault: dry-run; creates before.jsonl (includes previous), manifest.json and report.json. Never deletes cloud_saves.\n");
  process.exit(0);
}
const apply = args.includes("--apply");
const arg = (key: string) => args.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
const backupArg = arg("--backup-dir");
if (!backupArg || !backupArg.startsWith("/")) throw new Error("必须提供绝对路径 --backup-dir（建议每次运行新目录）");
const backupDir = resolve(backupArg), config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) throw new Error("仅支持 cloudbase-http");
assertPersistenceReady(config);
const target = saveTargetFingerprint(config), healthUrl = arg("--health-url");
let serverGeneration: string | undefined, serverProgressVersion: string | undefined, serverTarget: string | undefined;
if (apply && !healthUrl) throw new Error("apply 必须提供已部署服务 --health-url=https://host/health");
if (healthUrl) {
  if (!healthUrl.startsWith("https://")) throw new Error("健康检查 URL 必须为 https");
  const response = await fetch(healthUrl, {signal: AbortSignal.timeout(10000), redirect: "error"});
  const body = await response.json() as {data?: {saveGeneration?: string; progressVersion?: string; saveTarget?: string; persistence?: string; platform?: string}};
  if (!response.ok || body.data?.persistence !== "cloudbase-http" || body.data.platform !== "wechat") throw new Error("健康检查未确认微信云数据库服务");
  serverGeneration = body.data.saveGeneration; serverProgressVersion = body.data.progressVersion; serverTarget = body.data.saveTarget;
  if (serverTarget !== target) throw new Error("健康检查数据库目标不一致");
  if (apply && (serverGeneration !== CAMPAIGN_SAVE_POLICY.generation || serverProgressVersion !== CAMPAIGN_SAVE_POLICY.progressVersion)) throw new Error("健康检查关卡批次/进度版本不一致，先部署新版服务端");
}
await mkdir(backupDir, {recursive: true, mode: 0o700});
const backup = await open(resolve(backupDir, "before.jsonl"), "wx", 0o600);
try {
  await writeFile(resolve(backupDir, "manifest.json"), JSON.stringify({createdAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", target, generation: CAMPAIGN_SAVE_POLICY.generation, progressVersion: CAMPAIGN_SAVE_POLICY.progressVersion,
    health: {serverGeneration, serverProgressVersion, serverTarget}}, null, 2), {flag: "wx", mode: 0o600});
  const app = cloudbase.init({env: config.cloudbaseEnvId, region: config.cloudbaseRegion, accessKey: config.cloudbaseApiKey, timeout: 8000});
  const database = app.database({instance: config.cloudbaseDatabaseInstance, database: config.cloudDatabaseName}) as CloudBaseDatabase;
  const report = await resetCampaignProgress(database, {
    apply, expectedGeneration: CAMPAIGN_SAVE_POLICY.generation, expectedProgressVersion: CAMPAIGN_SAVE_POLICY.progressVersion, expectedTarget: target,
    ...(serverGeneration ? {serverGeneration} : {}), ...(serverProgressVersion ? {serverProgressVersion} : {}), ...(serverTarget ? {serverTarget} : {}),
    backup: async entry => {await backup.write(`${JSON.stringify(entry)}\n`); await backup.sync();},
  });
  await writeFile(resolve(backupDir, "report.json"), JSON.stringify({...report, target}, null, 2), {flag: "wx", mode: 0o600});
  await new Promise<void>((resolveOutput, rejectOutput) => {
    process.stdout.write(`${JSON.stringify({...report, target, backupDir})}\n`, error => error ? rejectOutput(error) : resolveOutput());
  });
  if (report.conflicts || report.leaderboardConflicts || report.concurrentAdvanced) process.exitCode = 2;
} finally {
  await backup.close();
}

// CloudBase SDK 可能保留定时器/连接；全部请求、报告输出及备份关闭均已 await 后再退出。
process.exit(process.exitCode ?? 0);
