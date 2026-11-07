import {describe,it,expect} from "vitest";
import {resetDevelopmentGameSaves} from "../src/domain/save/DevelopmentSaveReset.js";
import type {CloudBaseDatabase} from "../src/infrastructure/persistence/CloudBaseDatabase.js";
function database(){
 const rows:Record<string,{_id:string}[]>={cloud_saves:Array.from({length:205},(_,i)=>({_id:`p${i}`})),level_leaderboard:[{_id:"p1"}],players:[{_id:"p1"}],sessions:[{_id:"s1"}],remote_configs:[{_id:"c1"}]};
 const touched:string[]=[];
 const db={collection(name:string){touched.push(name);return{where(){let limit=100;return{count:()=>Promise.resolve({total:rows[name]!.length}),limit(n:number){limit=n;return this;},get:()=>Promise.resolve({data:rows[name]!.slice(0,limit)})};},doc(id:string){return{remove:()=>{rows[name]=rows[name]!.filter(r=>r._id!==id);return Promise.resolve({});}};}};}} as unknown as CloudBaseDatabase;
 return{db,rows,touched};
}
describe("开发期统一清档",()=>{
 it("默认只计数；清档仅删除游戏存档及进度排行，分页无遗漏",async()=>{
  const {db,rows,touched}=database();
  const dry=await resetDevelopmentGameSaves(db,{apply:false,expectedGeneration:"new",expectedTarget:"env-a"});
  expect(dry.before).toEqual({cloud_saves:205,level_leaderboard:1});expect(rows.cloud_saves).toHaveLength(205);
  const result=await resetDevelopmentGameSaves(db,{apply:true,expectedGeneration:"new",expectedTarget:"env-a",serverGeneration:"new",serverTarget:"env-a"});
  expect(result.removed).toEqual({cloud_saves:205,level_leaderboard:1});expect(result.after).toEqual({cloud_saves:0,level_leaderboard:0});
  expect([...new Set(touched)]).toEqual(["cloud_saves","level_leaderboard"]);expect(rows.players).toHaveLength(1);expect(rows.sessions).toHaveLength(1);expect(rows.remote_configs).toHaveLength(1);
 });
 it("服务端未启用同批次拒绝旧档时禁止删除",async()=>{
  const {db,rows}=database();
  await expect(resetDevelopmentGameSaves(db,{apply:true,expectedGeneration:"new",expectedTarget:"env-a",serverGeneration:"old"})).rejects.toThrow(/批次/);
  expect(rows.cloud_saves).toHaveLength(205);
 });
});

it("核对相同批次仍必须绑定实际删除环境，不能用另一个服务通过检查",async()=>{
 const {db,rows}=database();
 await expect(resetDevelopmentGameSaves(db,{apply:true,expectedGeneration:"new",serverGeneration:"new",expectedTarget:"env-a",serverTarget:"env-b"})).rejects.toThrow(/目标/);
 expect(rows.cloud_saves).toHaveLength(205);
});
