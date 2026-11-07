import type {CloudBaseDatabase} from "../../infrastructure/persistence/CloudBaseDatabase.js";
const COLLECTIONS = ["cloud_saves", "level_leaderboard"] as const;
type Counts = Record<typeof COLLECTIONS[number], number>;
/** 只允许开发期统一重置这两类游戏数据，绝不接受调用方传入集合名。 */
export async function resetDevelopmentGameSaves(database: CloudBaseDatabase, options: {
  readonly apply: boolean;
  readonly expectedGeneration: string;
  readonly serverGeneration?: string;
  readonly expectedTarget: string;
  readonly serverTarget?: string;
}) {
  if (options.apply && (!options.expectedGeneration || options.serverGeneration !== options.expectedGeneration)) {
    throw new Error("服务端存档批次未确认一致，拒绝清档");
  }
  if (options.apply && (!options.expectedTarget || options.serverTarget !== options.expectedTarget)) {
    throw new Error("健康检查服务与清档目标不一致，拒绝清档");
  }
  const counts = async (): Promise<Counts> => {
    const values = await Promise.all(COLLECTIONS.map(async name => [name, (await database.collection(name).where({}).count()).total]));
    return Object.fromEntries(values) as Counts;
  };
  const before = await counts(), removed: Counts = {cloud_saves: 0, level_leaderboard: 0};
  if (options.apply) {
    for (const name of COLLECTIONS) {
      const collection = database.collection(name);
      // 每次从第一页删除；禁止一边删除一边使用 offset 跳过剩余记录。
      for (let batch = 0; ; batch++) {
        if (batch >= 10000) throw new Error("清档超过批次上限，请检查并发写入");
        const {data} = await collection.where({}).limit(100).get();
        if (!data.length) break;
        for (const item of data) {
          if (!item || typeof item !== "object" || !("_id" in item) || typeof item._id !== "string") throw new Error("清档记录缺少有效 _id");
          const result = await collection.doc(item._id).remove();
          if (result.code && result.code !== "SUCCESS") throw new Error(`清档删除失败: ${result.code}`);
          removed[name]++;
        }
      }
    }
  }
  const after = await counts();
  if (options.apply && COLLECTIONS.some(name => after[name] !== 0)) throw new Error("清档后仍有游戏记录，请检查并发写入");
  return {mode: options.apply ? "apply" : "dry-run", generation: options.expectedGeneration, before, removed, after};
}
