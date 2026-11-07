import {createHash} from "node:crypto";
import {describe, it, expect, vi} from "vitest";
import {CloudSaveService} from "../src/domain/save/CloudSaveService.js";
import {InMemoryCloudSaveRepository} from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import {InMemorySessionRepository} from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import {validateCloudSaveInput, stableStringify} from "../src/domain/save/CloudSaveValidation.js";
import {LevelLeaderboardProjector} from "../src/domain/leaderboard/LevelLeaderboardProjector.js";
const generation="mixed99-20261105", progressVersion="rhythm80-20261106", token="campaign-progress-token";
function input(version: string | undefined = progressVersion, baseRevision=0) {
 return {baseRevision,clientVersion:"1",clientSavedAt:100,idempotencyKey:`progress-request-${baseRevision}`,save:{generation,version:"1",serialized:1 as const,time:100,modules:{user:{level:6,gold:25,...(version===undefined?{}:{levelProgressVersion:version})}}}};
}
async function setup() {
 const sessions=new InMemorySessionRepository(), saves=new InMemoryCloudSaveRepository();
 await sessions.save({tokenHash:createHash("sha256").update(token).digest("hex"),playerId:"p",createdAt:1,expiresAt:10000});
 const service=new CloudSaveService({sessions,saves,requiredGeneration:generation,requiredProgressVersion:progressVersion,firstPlayableLevel:6,now:()=>1000});
 return {sessions,saves,service};
}
describe("80关进度版本与资产保留",()=>{
 it("缺少或错误进度版本的旧客户端无法写入，同批次旧云档仍返回真实revision与资产",async()=>{
  const {sessions,saves,service}=await setup();
  const old=new CloudSaveService({sessions,saves,now:()=>900});
  await old.put(`Bearer ${token}`,input("old"));
  await expect(service.put(`Bearer ${token}`,input("old",1))).rejects.toMatchObject({code:"SAVE_PROGRESS_VERSION_MISMATCH"});
  const missing=input("old",1); delete (missing.save.modules.user as {levelProgressVersion?:string}).levelProgressVersion;
  await expect(service.put(`Bearer ${token}`,missing)).rejects.toMatchObject({code:"SAVE_PROGRESS_VERSION_MISMATCH"});
  expect(await service.get(`Bearer ${token}`)).toMatchObject({exists:true,revision:1,save:{modules:{user:{gold:25,levelProgressVersion:"old"}}}});
 });
 it("首次新版上传保留已存资产与未知模块，拒绝客户端伪造未知字段，合并后hash/size与幂等正确",async()=>{
  const {saves,service}=await setup();
  const stored=input("old").save;
  const full={...stored,modules:{user:{...stored.modules.user,adFreeCount:7,totalRechargeAmount:88,futureAsset:{count:42}},collection:{cards:[1,2]},settings:{music:0}}};
  await saves.compareAndSet({playerId:"p",baseRevision:0,clientVersion:"old",clientSavedAt:90,idempotencyKey:"seed-record-key",requestHash:"seed",hash:"seed",sizeBytes:1,save:full,serverSavedAt:900});
  const next=input(progressVersion,1); Object.assign(next.save.modules.user,{futureAsset:{count:0},evilNewAsset:100});
  const saved=await service.put(`Bearer ${token}`,next);
  const record=(await saves.findByPlayerId("p"))!;
  expect(record.save.modules).toEqual({user:{level:6,gold:25,levelProgressVersion:progressVersion,adFreeCount:7,totalRechargeAmount:88,futureAsset:{count:42}},collection:{cards:[1,2]},settings:{music:0}});
  const canonical=stableStringify(record.save);
  expect(record.hash).toBe(createHash("sha256").update(canonical).digest("hex"));
  expect(record.sizeBytes).toBe(Buffer.byteLength(canonical));
  expect(record.previous?.save).toEqual(full);
  expect(await service.put(`Bearer ${token}`,next)).toEqual({...saved,duplicate:true});
  await expect(service.put(`Bearer ${token}`,{...next,idempotencyKey:"another-request"})).rejects.toMatchObject({current:{revision:2}});
 });
 it("排行投影不接受同generation旧进度任务",async()=>{
  const findById=vi.fn(),upsertScore=vi.fn();
  const projector=new LevelLeaderboardProjector({requiredGeneration:generation,requiredProgressVersion:progressVersion,players:{findById},profiles:{findByPlayerId:vi.fn()},leaderboard:{upsertScore}} as never);
  await projector.syncSave("p",input("old").save,1000);
  expect(findById).not.toHaveBeenCalled();expect(upsertScore).not.toHaveBeenCalled();
 });
});

it("正常上传完整保留动物资产与跨设备游玩计数",()=>{
 const animals=[{id:50100,stars:3,using:1},{id:50109,getTime:123,using:0,unknownAnimalAsset:{x:2}}];
 const request=input();Object.assign(request.save.modules.user,{animals,totalPlayCount:80,todayPlayCount:4,todayNormalPlayCount:3});
 expect(validateCloudSaveInput(request).save.modules.user).toMatchObject({animals,totalPlayCount:80,todayPlayCount:4,todayNormalPlayCount:3});
});

it("工具尚未处理的历史previous也不能通过后台回滚恢复旧进度",async()=>{
 const {sessions,saves}=await setup();const legacy=new CloudSaveService({sessions,saves,now:()=>900});
 await legacy.put(`Bearer ${token}`,input("old"));
 await legacy.put(`Bearer ${token}`,input(progressVersion,1));
 await saves.rollbackPrevious({playerId:"p",expectedRevision:2,serverSavedAt:1100,auditKey:"pre-migration-rollback"});
 expect((await saves.findByPlayerId("p"))!.save.modules.user).toMatchObject({level:6,levelMaxProgress:0,winnerStreakCount:0,levelProgressVersion:progressVersion,gold:25});
});
