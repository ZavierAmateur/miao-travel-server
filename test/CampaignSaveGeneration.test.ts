import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {CloudSaveService} from "../src/domain/save/CloudSaveService.js";
import {InMemoryCloudSaveRepository} from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import {InMemorySessionRepository} from "../src/infrastructure/repositories/InMemorySessionRepository.js";
import type {PutCloudSaveInput} from "../src/domain/save/CloudSaveValidation.js";
const generation="mixed99-20261105",token="campaign-generation-token";
const input=(gen?:string):PutCloudSaveInput=>({baseRevision:0,clientVersion:"1.0.0",clientSavedAt:100,idempotencyKey:"campaign-save-0001",save:{version:"1.0.0",serialized:1,time:100,...(gen?{generation:gen}:{}),modules:{user:{level:6,gold:0,energy:10}}}});
async function setup(){const sessions=new InMemorySessionRepository(),saves=new InMemoryCloudSaveRepository();await sessions.save({tokenHash:createHash("sha256").update(token).digest("hex"),playerId:"campaign-player",createdAt:1,expiresAt:10000});return{sessions,saves};}
describe("99关重排存档批次",()=>{
 it("旧客户端和错误批次不能写回，新批次字段完整保留",async()=>{
  const deps=await setup(),service=new CloudSaveService({...deps,requiredGeneration:generation,now:()=>1000});
  await expect(service.put(`Bearer ${token}`,input())).rejects.toMatchObject({code:"SAVE_GENERATION_MISMATCH"});
  await expect(service.put(`Bearer ${token}`,input("old"))).rejects.toMatchObject({code:"SAVE_GENERATION_MISMATCH"});
  expect(await deps.saves.findByPlayerId("campaign-player")).toBeUndefined();
  await service.put(`Bearer ${token}`,input(generation));
  expect(await service.get(`Bearer ${token}`)).toMatchObject({exists:true,generation,save:{generation,modules:{user:{level:6}}}});
 });
 it("旧云档不交给新客户端恢复，旧文档在执行清档前仍保留供明确核对",async()=>{
  const deps=await setup(),oldService=new CloudSaveService({...deps,now:()=>1000});await oldService.put(`Bearer ${token}`,input());
  const service=new CloudSaveService({...deps,requiredGeneration:generation,now:()=>1000});
  expect(await service.get(`Bearer ${token}`)).toMatchObject({exists:false,revision:0,save:null,generation});
  expect(await deps.saves.findByPlayerId("campaign-player")).toMatchObject({revision:1});
 });
});

import {vi} from "vitest";
import {LevelLeaderboardProjector} from "../src/domain/leaderboard/LevelLeaderboardProjector.js";
it("旧批次待同步任务不能重新生成旧进度排行",async()=>{
 const findById=vi.fn(),upsertScore=vi.fn();
 const projector=new LevelLeaderboardProjector({requiredGeneration:generation,players:{findById},leaderboard:{upsertScore},profiles:{findByPlayerId:vi.fn()}} as never);
 await projector.syncSave("p1",input().save as never,100);
 expect(findById).not.toHaveBeenCalled();expect(upsertScore).not.toHaveBeenCalled();
});
