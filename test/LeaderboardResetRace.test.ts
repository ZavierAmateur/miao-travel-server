import {it,expect} from "vitest";
import {CloudBaseLevelLeaderboardRepository} from "../src/infrastructure/repositories/CloudBaseLevelLeaderboardRepository.js";
import type {CloudBaseCollectionReference} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
it("资料同步在清档删除记录后恢复执行，不能重建旧分数或旧排行",async()=>{
 let record:Record<string,unknown>|undefined={_id:"p1",playerId:"p1",platform:"wechat",level:44,nickName:"old",avatarUrl:"",reachedAt:1,scoreUpdatedAt:1,updatedAt:1};
 let release!:()=>void;const barrier=new Promise<void>(r=>release=r);let read!:()=>void;const wasRead=new Promise<void>(r=>read=r);
 const collection={doc:()=>({get:async()=>{const snapshot={...record};read();await barrier;return{requestId:"t",data:[snapshot]};},set:(value:object)=>{record={...value};return Promise.resolve({requestId:"t"});}}),where:()=>({update:(value:object)=>{if(record)Object.assign(record,value);return Promise.resolve({requestId:"t",updated:record?1:0});}})} as unknown as CloudBaseCollectionReference;
 const repo=new CloudBaseLevelLeaderboardRepository(collection,{command:{set:v=>v,lt:v=>v},RegExp:()=>({})});
 const pending=repo.updateProfile("p1",{nickName:"new",avatarUrl:"",updatedAt:2});await wasRead;record=undefined;release();await pending;expect(record).toBeUndefined();
});
