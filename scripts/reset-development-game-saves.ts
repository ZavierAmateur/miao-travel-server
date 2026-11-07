import {saveTargetFingerprint} from "../src/domain/save/SaveTargetFingerprint.js";
import cloudbase from "@cloudbase/js-sdk";
import {PersistenceDriver, assertPersistenceReady, loadConfig} from "../src/config/AppConfig.js";
import {CAMPAIGN_SAVE_POLICY} from "../src/domain/save/CampaignSavePolicy.js";
import {resetDevelopmentGameSaves} from "../src/domain/save/DevelopmentSaveReset.js";
import type {CloudBaseDatabase} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
const apply = process.argv.includes("--apply"), config = loadConfig();
if (config.persistenceDriver !== PersistenceDriver.CloudBaseHttp) throw new Error("清档仅支持 cloudbase-http");
assertPersistenceReady(config);
let serverGeneration: string | undefined, serverTarget: string | undefined;
if (apply) {
  const urlArg = process.argv.find(arg => arg.startsWith("--health-url="))?.slice(13);
  if (!urlArg || !urlArg.startsWith("https://")) throw new Error("执行清档必须提供已部署服务的 https --health-url");
  const response = await fetch(urlArg, {signal: AbortSignal.timeout(10000)});
  const body = await response.json() as {data?: {saveGeneration?: string; saveTarget?: string; persistence?: string; platform?: string}};
  if (!response.ok || body.data?.persistence !== "cloudbase-http" || body.data?.platform !== "wechat") throw new Error("健康检查未确认微信云数据库服务");
  serverGeneration = body.data.saveGeneration;
  serverTarget = body.data.saveTarget;
}
const app = cloudbase.init({env: config.cloudbaseEnvId, region: config.cloudbaseRegion, accessKey: config.cloudbaseApiKey, timeout: 8000});
const database = app.database({instance: config.cloudbaseDatabaseInstance, database: config.cloudDatabaseName}) as CloudBaseDatabase;
const report = await resetDevelopmentGameSaves(database, {
  apply, expectedGeneration: CAMPAIGN_SAVE_POLICY.generation, expectedTarget: saveTargetFingerprint(config), ...(serverGeneration ? {serverGeneration} : {}), ...(serverTarget ? {serverTarget} : {}),
});
process.stdout.write(JSON.stringify({...report, target: saveTargetFingerprint(config)}) + "\n", () => process.exit(0));
