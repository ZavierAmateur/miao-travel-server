import { describe, expect, it, vi } from "vitest";
import { CloudBaseBootstrapConfigRepository } from "../src/infrastructure/repositories/CloudBaseBootstrapConfigRepository.js";
import type { CloudBaseCollectionReference } from "../src/infrastructure/persistence/CloudBaseDatabase.js";
import { DEFAULT_BOOTSTRAP_CONFIG, type BootstrapConfigRecord } from "../src/domain/config/BootstrapConfig.js";

function database(seed?: BootstrapConfigRecord) {
  let document: (BootstrapConfigRecord & { _id: string }) | undefined = seed ? { ...seed, _id: "bootstrap" } : undefined;
  const update = vi.fn((query: { revision: number }, next: BootstrapConfigRecord) => {
    // 模拟数据库禁止更新不可变主键，读取文档确实会包含_id。
    if ("_id" in next) return Promise.reject(new Error("immutable _id"));
    if (!document || document.revision !== query.revision) return Promise.resolve({ updated: 0 });
    document = { ...document, ...next }; return Promise.resolve({ updated: 1 });
  });
  const collection = {
    doc: () => ({ get: () => Promise.resolve({ data: document ? [document] : [] }) }),
    where: (query: { revision: number }) => ({ update: (next: BootstrapConfigRecord) => update(query, next) }),
    add: vi.fn((next: BootstrapConfigRecord & { _id: string }) => {
      if (document) return Promise.reject(new Error("duplicate id")); document = next; return Promise.resolve({});
    }),
  } as unknown as CloudBaseCollectionReference;
  return { collection, update, record: () => document };
}
describe("启动配置原子更新", () => {
  it("修改真实读取的文档时不把_id放入update，旧revision不能覆盖", async () => {
    const db = database({ ...DEFAULT_BOOTSTRAP_CONFIG, revision: 3 });
    const repo = new CloudBaseBootstrapConfigRepository(db.collection);
    const current = (await repo.find())!;
    expect(await repo.compareAndSet(3, { ...current, revision: 4, latestClientVersion: "1.3.0" })).toBe(true);
    expect(await repo.compareAndSet(3, { ...current, revision: 4, latestClientVersion: "1.4.0" })).toBe(false);
    expect(db.record()?.latestClientVersion).toBe("1.3.0");
  });
  it("首次初始化并发用固定ID，只有一个写入成功", async () => {
    const db = database(); const repo = new CloudBaseBootstrapConfigRepository(db.collection);
    const record = { ...DEFAULT_BOOTSTRAP_CONFIG, revision: 1, latestClientVersion: "1.0.0" };
    const results = await Promise.all([repo.compareAndSet(0, record), repo.compareAndSet(0, record)]);
    expect(results.sort()).toEqual([false, true]); expect(db.record()?.revision).toBe(1);
  });
});
