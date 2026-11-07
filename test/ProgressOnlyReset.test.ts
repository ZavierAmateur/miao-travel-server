import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {planProgressReset, resetCampaignProgress, assetFingerprint} from "../src/domain/save/ProgressOnlyReset.js";
import {CloudBaseCloudSaveRepository} from "../src/infrastructure/repositories/CloudBaseCloudSaveRepository.js";
import {validateCloudSaveInput,stableStringify} from "../src/domain/save/CloudSaveValidation.js";
import type {CloudSaveRecord} from "../src/domain/save/CloudSave.js";
import type {CloudBaseDatabase, CloudBaseQueryReference} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
const version="rhythm80-20261106",generation="mixed99-20261105";
function record(id="p"):CloudSaveRecord {
 const save={generation,version:"1",serialized:1 as const,time:20,modules:{user:{level:45,levelMaxProgress:4,winnerStreakCount:9,gold:123,energy:7,energyTimer:80,totalPlayCount:120,animals:[{id:50109,using:1}],adFreeCount:3,totalRechargeAmount:58,unknownAsset:{a:[1,2]}},collection:{cards:[4,5]},task:{done:[1]},futureModule:{value:99}}};
 const snap={revision:7,clientVersion:"1",clientSavedAt:20,serverSavedAt:30,hash:"old",sizeBytes:99,save};
 return {...snap,playerId:id,lastIdempotencyKey:"old-key",lastRequestHash:"old-request",previous:{...snap,revision:6,save:structuredClone(save)}};
}
function database(records:CloudSaveRecord[], race=false, corrupt=false) {
 const rows:Record<string,Map<string,Record<string,unknown>>>={cloud_saves:new Map(records.map(r=>[r.playerId,{...structuredClone(r),_id:r.playerId}])),level_leaderboard:new Map(records.map(r=>[r.playerId,{_id:r.playerId,playerId:r.playerId,level:45,nickName:"昵称",avatarUrl:"avatar",scoreUpdatedAt:30,updatedAt:32,reachedAt:10,sortKey:"old"}]))};
 const touched:string[]=[];let first=true;
 const db={command:{set:(v:unknown)=>({$set:v})},collection:(name:string)=>{touched.push(name);const table=rows[name]!;return {doc:(id:string)=>({get:()=>Promise.resolve({data:table.has(id)?[structuredClone(table.get(id))]:[]})}),where:(query:object)=>{
  let offset=0,limit=100;const matches=()=>[...table.values()].filter(r=>Object.entries(query).every(([k,v])=>r[k]===v)).sort((a,b)=>String(a._id).localeCompare(String(b._id)));
  const ref={get:()=>Promise.resolve({data:matches().slice(offset,offset+limit).map(r=>structuredClone(r))}),update:(data:object)=>{if(race&&first&&name==="cloud_saves"){first=false;table.get(records[0]!.playerId)!.revision=8;}const matched=matches();for(const row of matched)for(const [key,v]of Object.entries(data as Record<string,unknown>))row[key]=v&&typeof v==="object"&&"$set"in v?structuredClone(v.$set):structuredClone(v);if(corrupt&&name==="cloud_saves"&&matched[0])delete ((matched[0].save as CloudSaveRecord["save"]).modules.user as Record<string,unknown>).gold;return Promise.resolve({updated:matched.length});},skip:(n:number)=>{offset=n;return ref;},limit:(n:number)=>{limit=n;return ref;},orderBy:()=>ref} as unknown as CloudBaseQueryReference;return ref;}};}} as unknown as CloudBaseDatabase;
 return{db,rows,touched};
}
const options={apply:true,expectedGeneration:generation,serverGeneration:generation,expectedProgressVersion:version,serverProgressVersion:version,expectedTarget:"target",serverTarget:"target",now:()=>1000};
describe("仅关卡进度迁移",()=>{
 it("current/previous只改四字段、hash/size重算，资产守恒且不会修改输入",()=>{
  const before=record(),original=structuredClone(before),plan=planProgressReset(before,1000);
  expect(plan.changed).toBe(true);expect(before).toEqual(original);
  for(const [old,next]of [[before,plan.record],[before.previous!,plan.record.previous!]] as const){
   expect(next.save.modules.user).toMatchObject({level:6,levelMaxProgress:0,winnerStreakCount:0,levelProgressVersion:version});
   expect(assetFingerprint(next.save)).toBe(assetFingerprint(old.save));
   const canonical=stableStringify(next.save);expect(next.hash).toBe(createHash("sha256").update(canonical).digest("hex"));expect(next.sizeBytes).toBe(Buffer.byteLength(canonical));
  }
  expect(plan.record.revision).toBe(8);expect(plan.record.leaderboardSyncPending).toBe(true);
  const played=structuredClone(plan.record);Object.assign(played.save.modules.user!,{level:17,levelMaxProgress:2,winnerStreakCount:4});
  expect(planProgressReset(played,2000)).toEqual({changed:false,record:played});
 });
 it("已玩新版本但previous仍旧时只修复previous，不能重置新进度",()=>{
  const before=record();Object.assign(before.save.modules.user!,{levelProgressVersion:version,level:23});
  const plan=planProgressReset(before,1000);expect(plan.record.save).toEqual(before.save);expect(plan.record.previous?.save.modules.user).toMatchObject({level:6,levelProgressVersion:version});
 });
 it("默认dry-run只备份和计算，不写云档或排行；205份分页无遗漏",async()=>{
  const {db,rows,touched}=database(Array.from({length:205},(_,i)=>record(`p${String(i).padStart(3,"0")}`)));const before=structuredClone(rows);const backups:unknown[]=[];
  const result=await resetCampaignProgress(db,{expectedGeneration:generation,expectedProgressVersion:version,expectedTarget:"target",backup:entry=>{backups.push(entry);return Promise.resolve();}});
  expect(result).toMatchObject({mode:"dry-run",scanned:205,changed:205,updated:0,conflicts:0});expect(rows).toEqual(before);expect(backups.length).toBe(410);expect([...new Set(touched)].sort()).toEqual(["cloud_saves","level_leaderboard"]);
 });
 it("apply先完整备份before/previous，再revision CAS；排行保留资料，重复执行不清新进度",async()=>{
  const {db,rows}=database([record()]);const backups:Record<string,unknown>[]=[];
  const backup=(entry:Record<string,unknown>)=>{backups.push(entry);if(entry.collection==="cloud_saves")expect(rows.cloud_saves!.get("p")!.revision).toBe(7);return Promise.resolve();};
  expect(await resetCampaignProgress(db,{...options,backup})).toMatchObject({updated:1,leaderboardUpdated:1,conflicts:0});
  expect(backups[0]).toMatchObject({collection:"cloud_saves",before:{previous:{save:{modules:{user:{gold:123}}}}}});
  expect(rows.level_leaderboard!.get("p")).toMatchObject({level:6,nickName:"昵称",avatarUrl:"avatar",progressVersion:version});
  Object.assign((rows.cloud_saves!.get("p")!.save as CloudSaveRecord["save"]).modules.user!,{level:19});
  expect(await resetCampaignProgress(db,{...options,backup:()=>Promise.resolve()})).toMatchObject({changed:0,updated:0,leaderboardUpdated:0});
  expect((rows.cloud_saves!.get("p")!.save as CloudSaveRecord["save"]).modules.user).toMatchObject({level:19});
 });
 it("备份失败或健康版本/目标不符不允许写入，并发revision冲突保留新写入",async()=>{
  for(const bad of [{serverProgressVersion:"old"},{serverTarget:"other"},{serverGeneration:"old"}]){const{db,rows}=database([record()]);await expect(resetCampaignProgress(db,{...options,...bad,backup:()=>Promise.resolve()})).rejects.toThrow();expect(rows.cloud_saves!.get("p")!.revision).toBe(7);}
  const broken=database([record()]);await expect(resetCampaignProgress(broken.db,{...options,backup:()=>Promise.reject(Error("disk"))})).rejects.toThrow("disk");expect(broken.rows.cloud_saves!.get("p")!.revision).toBe(7);
  const concurrent=database([record()],true);expect(await resetCampaignProgress(concurrent.db,{...options,backup:()=>Promise.resolve()})).toMatchObject({updated:0,conflicts:1});expect((concurrent.rows.cloud_saves!.get("p")!.save as CloudSaveRecord["save"]).modules.user).toMatchObject({level:45});expect(concurrent.rows.level_leaderboard!.get("p")!.level).toBe(45);
 });
});

it("reset→首次客户端上传→后台回滚保留多动物、额外属性、未知资产与模块",async()=>{
 const before=record();Object.assign(before.save.modules.user!,{animals:[{id:50100,using:1,stars:3},{id:50109,using:0,unlock:1,extras:{gift:8}}]});
 const {db}=database([before]);await resetCampaignProgress(db,{...options,backup:()=>Promise.resolve()});
 const saves=new CloudBaseCloudSaveRepository(db.collection("cloud_saves"),db.command);
 const reset=(await saves.findByPlayerId("p"))!;
 const command=validateCloudSaveInput({baseRevision:8,clientVersion:"new",clientSavedAt:1200,idempotencyKey:"new-client-save-request",save:{...reset.save,modules:{user:{level:7,levelMaxProgress:0,winnerStreakCount:1,levelProgressVersion:version,gold:123,animals:(reset.save.modules.user as Record<string,never>).animals}}}});
 const written=await saves.compareAndSet({playerId:"p",...command,serverSavedAt:1200});expect(written.status).toBe("saved");
 const after=(await saves.findByPlayerId("p"))!;
 expect(after.save.modules.user).toMatchObject({adFreeCount:3,totalRechargeAmount:58,unknownAsset:{a:[1,2]},animals:(before.save.modules.user as Record<string,never>).animals});
 expect(after.save.modules.futureModule).toEqual(before.save.modules.futureModule);
 const rolled=await saves.rollbackPrevious({playerId:"p",expectedRevision:9,serverSavedAt:1300,auditKey:"asset-preservation"});
 expect(rolled.status).toBe("saved");
 const restored=(await saves.findByPlayerId("p"))!;
 expect(restored.save.modules.user).toMatchObject({level:6,levelProgressVersion:version,animals:(before.save.modules.user as Record<string,never>).animals});
 expect(assetFingerprint(restored.save)).toBe(assetFingerprint(before.save));
 expect(restored.previous?.save.modules.user).toMatchObject({level:7,levelProgressVersion:version});
 const canonical=stableStringify(restored.save);expect(restored.hash).toBe(createHash("sha256").update(canonical).digest("hex"));expect(restored.sizeBytes).toBe(Buffer.byteLength(canonical));
});

it("apply对实际落库current与previous复读核对，检测资产或摘要意外变动",async()=>{
 const {db}=database([record()],false,true);
 await expect(resetCampaignProgress(db,{...options,backup:()=>Promise.resolve()})).rejects.toThrow(/落库|守恒|摘要/);
});

it("孤立排行榜缺少云档时精确跳过并报告，dry-run和apply都不改孤立记录",async()=>{
 for(const apply of [false,true]) {
  const {db,rows}=database([]);
  const orphan={_id:"orphan",playerId:"orphan",level:45,scoreUpdatedAt:30,reachedAt:10};
  rows.level_leaderboard!.set("orphan",structuredClone(orphan));
  const collection=db.collection.bind(db);
  const missing={...db,collection:(name:string)=>{
   const current=collection(name);
   return name==="cloud_saves" ? {...current,doc:()=>({get:()=>Promise.reject(Object.assign(new Error("document not found"),{code:"DOCUMENT_NOT_FOUND"}))})} : current;
  }} as unknown as CloudBaseDatabase;
  const backups:Record<string,unknown>[]=[];
  const result=await resetCampaignProgress(missing,{...options,apply,backup:entry=>{backups.push(entry);return Promise.resolve();}});
  expect(result).toMatchObject({leaderboardScanned:1,leaderboardOrphans:1,leaderboardUpdated:0});
  expect(rows.level_leaderboard!.get("orphan")).toEqual(orphan);
  expect(backups).toHaveLength(1);
 }
});

it("读取排行榜对应云档的权限或网络错误不能伪装成孤立记录",async()=>{
 const {db,rows}=database([]);
 rows.level_leaderboard!.set("p",{_id:"p",level:45,scoreUpdatedAt:30});
 const collection=db.collection.bind(db);
 const denied={...db,collection:(name:string)=>{
  const current=collection(name);
  return name==="cloud_saves" ? {...current,doc:()=>({get:()=>Promise.reject(Object.assign(new Error("permission denied"),{code:"PERMISSION_DENIED"}))})} : current;
 }} as unknown as CloudBaseDatabase;
 await expect(resetCampaignProgress(denied,{...options,backup:async()=>{}})).rejects.toThrow("permission denied");
 expect(rows.level_leaderboard!.get("p")!.level).toBe(45);
});
