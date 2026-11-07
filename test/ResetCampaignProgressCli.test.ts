import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

// 不读 .env、不触及云库。保留 SDK 活跃定时器，验证 CLI 完成真实文件写入后仍能退出。
describe("进度迁移CLI退出", () => {
  it.each([0, 1])("等待报告与备份关闭后退出，保留冲突码 conflicts=%i", conflicts => {
    const directory = mkdtempSync(join(tmpdir(), "rhythm80-cli-"));
    try {
      const script = new URL("../scripts/reset-campaign-progress.ts", import.meta.url).href;
      const report = {mode: "dry-run", conflicts, leaderboardConflicts: 0, concurrentAdvanced: 0};
      const bootstrap = `
        import {registerHooks} from 'node:module';
        const mocks = {
          '@cloudbase/js-sdk': 'export default {init(){setInterval(()=>{},1000);return{database(){return{}}}}}',
          '/AppConfig.js': 'export const PersistenceDriver={CloudBaseHttp:"cloudbase-http"};export function assertPersistenceReady(){};export function loadConfig(){return{persistenceDriver:"cloudbase-http",cloudbaseEnvId:"local-fixture",cloudbaseRegion:"local",cloudbaseDatabaseInstance:"test",cloudDatabaseName:"test"}}',
          '/ProgressOnlyReset.js': ${JSON.stringify(`export async function resetCampaignProgress(_db,options){await options.backup({fixture:"local-only"});return ${JSON.stringify(report)}}`)},
        };
        registerHooks({resolve(specifier,context,next){const key=Object.keys(mocks).find(key=>specifier===key||specifier.endsWith(key));return key?{url:'data:text/javascript,'+encodeURIComponent(mocks[key]),shortCircuit:true}:next(specifier,context)}});
        process.argv=[process.execPath,'reset-campaign-progress.ts',${JSON.stringify(`--backup-dir=${directory}`)}];
        await import(${JSON.stringify(script)});
      `;
      const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", bootstrap], {encoding: "utf8", timeout: 2000});
      expect(result.error?.message).toBeUndefined();
      expect(result.status, result.stderr).toBe(conflicts ? 2 : 0);
      expect(JSON.parse(readFileSync(join(directory, "report.json"), "utf8"))).toMatchObject(report);
      expect(JSON.parse(readFileSync(join(directory, "before.jsonl"), "utf8"))).toEqual({fixture: "local-only"});
      expect(JSON.parse(result.stdout.trim())).toMatchObject({...report, backupDir: directory});
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
});
