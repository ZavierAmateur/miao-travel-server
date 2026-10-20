import { describe, expect, it } from "vitest";
import { PlatformKind } from "../src/config/AppConfig.js";
import type { LevelLeaderboardEntry } from "../src/domain/leaderboard/LevelLeaderboard.js";
import type { CloudBaseAggregateReference, CloudBaseCollectionReference, CloudBaseDatabase, CloudBaseQueryReference } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { CloudBaseLevelLeaderboardRepository } from "../src/infrastructure/repositories/CloudBaseLevelLeaderboardRepository.js";

type Document = LevelLeaderboardEntry & { sortKey: string };
function sortKey(entry: LevelLeaderboardEntry): string {
  return `${String(1000000-entry.level).padStart(7,"0")}:${String(entry.reachedAt).padStart(16,"0")}:${entry.playerId}`;
}
function documents(size: number): Document[] {
  return Array.from({length:size}, (_,index) => {
    const entry: LevelLeaderboardEntry = {
      playerId:`player-${String(index).padStart(5,"0")}`,platform:index%2===0?"wechat":"bytedance",
      level:100000-index,nickName:index%37===0?`旅行CAT${index}`:`普通猫${index}`,avatarUrl:"",
      reachedAt:1000+index,scoreUpdatedAt:1000+index,updatedAt:1000+index,
    };
    return {...entry,sortKey:sortKey(entry)};
  });
}
function matches(value: unknown, condition: unknown): boolean {
  if (condition instanceof RegExp) return condition.test(String(value));
  if (typeof condition === "object" && condition !== null) {
    const op=condition as {lt?:string};
    if(op.lt!==undefined)return typeof value==="string"&&value<op.lt;
  }
  return value===condition;
}
function fixture(rows: Document[]) {
  const stored=new Map(rows.map(row=>[row.playerId,row]));
  const stats={fetches:[] as {filter:object;offset:number;limit:number;returned:number}[],docReads:0,countedRows:0,counts:0,aggregations:0,aggregateError:undefined as Error|undefined,countError:undefined as Error|undefined};
  const tools: Pick<CloudBaseDatabase,"command"|"RegExp">={
    command:{set:value=>value,lt:value=>({lt:value})},
    RegExp:({regexp,options})=>new RegExp(regexp,options),
  };
  const collection: CloudBaseCollectionReference={
    aggregate:()=>{
      let upper="",boundaries:readonly string[]=[];
      const aggregate:CloudBaseAggregateReference={
        match:filter=>{upper=(filter as {sortKey:{$lt:string}}).sortKey.$lt;return aggregate;},
        bucket:options=>{boundaries=options.boundaries;return aggregate;},
        end:()=>{
          stats.aggregations++;if(stats.aggregateError)return Promise.reject(stats.aggregateError);
          const counts=new Map<string,number>();
          for(const row of stored.values())if(row.sortKey<upper){
            const index=boundaries.findIndex((boundary,i)=>i>0&&row.sortKey<boundary)-1;
            if(index<0)throw new Error("排序键不在分桶区间");
            const key=boundaries[index]!;counts.set(key,(counts.get(key)??0)+1);stats.countedRows++;
          }
          return Promise.resolve({requestId:"aggregate",data:[...counts].map(([_id,count])=>({_id,count}))});
        },
      };
      return aggregate;
    },
    doc:id=>({
      get:()=>{stats.docReads++;return Promise.resolve({requestId:"doc",data:stored.has(id)?[stored.get(id)]:[]});},
      set:data=>{stored.set(id,data as Document);return Promise.resolve({requestId:"set"});},
      remove:()=>{stored.delete(id);return Promise.resolve({requestId:"remove"});},
    }),
    add:()=>Promise.resolve({requestId:"unused"}),
    where:filter=>{
      const candidate=()=>[...stored.values()].filter(row=>Object.entries(filter).every(([key,value])=>matches((row as unknown as Record<string,unknown>)[key],value))).sort((a,b)=>a.sortKey<b.sortKey?-1:a.sortKey>b.sortKey?1:0);
      let offset=0,limit=Infinity;
      const query:CloudBaseQueryReference={
        get:()=>{const data=candidate().slice(offset,offset+limit);stats.fetches.push({filter,offset,limit,returned:data.length});return Promise.resolve({requestId:"get",data});},
        count:()=>{
          stats.counts++;if(stats.countError)return Promise.reject(stats.countError);
          const total=candidate().length;stats.countedRows+=total;return Promise.resolve({requestId:"count",total});
        },
        update:()=>Promise.resolve({requestId:"unused",updated:0}),
        orderBy:()=>query,skip:value=>{offset=value;return query;},limit:value=>{limit=value;return query;},
      };
      return query;
    },
  };
  return{repository:new CloudBaseLevelLeaderboardRepository(collection,tools),stats,stored};
}

describe("CloudBase排行榜查询优化",()=>{
  it("一万名玩家中精确查询靠后ID，只读取该用户并计数名次，不下载前面的记录",async()=>{
    const h=fixture(documents(10000));
    const result=await h.repository.list({playerId:"player-09000",offset:0,limit:21});
    expect(result).toMatchObject([{rank:9001,entry:{playerId:"player-09000"}}]);
    expect(h.stats.docReads).toBe(1);expect(h.stats.fetches).toHaveLength(0);expect(h.stats.counts).toBe(1);
  });

  it("ID不存在、其他条件不匹配或ID查询第二页，不扫描榜单或无谓计数",async()=>{
    const h=fixture(documents(100));
    expect(await h.repository.list({playerId:"missing",offset:0,limit:21})).toEqual([]);
    expect(await h.repository.list({playerId:"player-00000",platform:"bytedance",offset:0,limit:21})).toEqual([]);
    expect(await h.repository.list({playerId:"player-00000",nickName:"不匹配",offset:0,limit:21})).toEqual([]);
    expect(await h.repository.list({playerId:"player-00000",offset:20,limit:21})).toEqual([]);
    expect(h.stats.docReads).toBe(3);expect(h.stats.counts).toBe(0);expect(h.stats.fetches).toHaveLength(0);
  });

  it("无筛选深页只取所需21条，排名由页偏移计算，无计数查询",async()=>{
    const h=fixture(documents(10000));
    const result=await h.repository.list({offset:4000,limit:21});
    expect(result).toHaveLength(21);expect(result[0]?.rank).toBe(4001);expect(result[20]?.rank).toBe(4021);
    expect(h.stats.fetches).toEqual([{filter:{},offset:4000,limit:21,returned:21}]);expect(h.stats.counts).toBe(0);
  });

  it("平台和昵称由数据库组合筛选，保留包含匹配、大小写忽略及全榜名次",async()=>{
    const h=fixture(documents(10000));
    const result=await h.repository.list({platform:"bytedance",nickName:"cat",offset:0,limit:21});
    expect(result).toHaveLength(21);
    expect(result.map(item=>item.rank)).toEqual(Array.from({length:21},(_,i)=>38+74*i));
    expect(h.stats.fetches).toHaveLength(1);expect(h.stats.fetches[0]).toMatchObject({offset:0,limit:21,returned:21});
    const filter=h.stats.fetches[0]!.filter as Record<string,unknown>;
    expect(filter.platform).toBe("bytedance");expect(filter.nickName).toBeInstanceOf(RegExp);
    expect(h.stats.counts).toBe(0);expect(h.stats.aggregations).toBe(1);
    expect(h.stats.countedRows).toBe(result[20]!.rank-1);
  });

  it("筛选结果第二页保持全榜名次，不重新从第一名编号",async()=>{
    const h=fixture(documents(200));
    const result=await h.repository.list({platform:"bytedance",offset:20,limit:21});
    expect(result.map(item=>item.rank)).toEqual(Array.from({length:21},(_,i)=>42+2*i));
    expect(h.stats.fetches).toMatchObject([{offset:20,limit:21,returned:21}]);
  });

  it("昵称正则特殊字符按字面匹配，不扩大结果范围",async()=>{
    const rows=documents(4);
    rows[0]={...rows[0]!,nickName:"猫.[1]+"};rows[1]={...rows[1]!,nickName:"猫X1"};
    const h=fixture(rows);
    const result=await h.repository.list({nickName:".[1]+",offset:0,limit:21});
    expect(result.map(item=>item.rank)).toEqual([1]);expect(h.stats.fetches[0]?.returned).toBe(1);
  });

  it("相同关卡和达到时间按玩家ID排序，计数名次与现有排序规则一致",async()=>{
    const rows=documents(3).map(row=>({...row,level:14,reachedAt:1000}));
    const h=fixture(rows.map(row=>({...row,sortKey:sortKey(row)})));
    const result=await h.repository.list({playerId:"player-00002",offset:0,limit:21});
    expect(result[0]?.rank).toBe(3);
  });

  it("空筛选结果不发起名次统计",async()=>{
    const h=fixture(documents(100));
    expect(await h.repository.list({nickName:"没有这只猫",offset:0,limit:21})).toEqual([]);
    expect(h.stats.fetches).toHaveLength(1);expect(h.stats.counts).toBe(0);
  });

  it("整页名次只发起一次聚合，统计失败不伪造排名或退回全榜扫描",async()=>{
    const h=fixture(documents(100));
    await h.repository.list({platform:"wechat",offset:0,limit:21});
    expect(h.stats.aggregations).toBe(1);expect(h.stats.counts).toBe(0);
    h.stats.aggregateError=new Error("aggregate unavailable");
    await expect(h.repository.list({platform:"wechat",offset:0,limit:21})).rejects.toThrow("aggregate unavailable");
    expect(h.stats.fetches).toHaveLength(2);expect(h.stats.aggregations).toBe(2);
    h.stats.countError=new Error("count unavailable");
    await expect(h.repository.list({playerId:"player-00001",offset:0,limit:21})).rejects.toThrow("count unavailable");
  });

  it("回滚和资料修改沿用现有投影字段，索引查询无需迁移旧记录",async()=>{
    const h=fixture([]);
    const base={playerId:"player-1",platform:PlatformKind.WeChat,level:14,nickName:"旧昵称",avatarUrl:"",updatedAt:1000};
    await h.repository.upsertScore(base);
    await h.repository.upsertScore({...base,level:13,updatedAt:2000});
    await h.repository.updateProfile(base.playerId,{nickName:"新昵称",avatarUrl:"",updatedAt:3000});
    const result=await h.repository.list({nickName:"新昵称",offset:0,limit:21});
    expect(result).toMatchObject([{rank:1,entry:{level:13,nickName:"新昵称",reachedAt:2000}}]);
  });
});
