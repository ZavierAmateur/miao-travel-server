import { describe, expect, it } from "vitest";
import type { CloudSavePayload } from "../src/domain/save/CloudSave.js";
import { cleanupLegacyPetState, normalizeCurrentPetRecords } from "../src/domain/save/PetSaveCleanup.js";

describe("旧宠物云存档清理", () => {
  it("只保留默认宠物并删除旧宠物及尚未开放候选", () => {
    expect(normalizeCurrentPetRecords([
      { id: 50008, getTime: 1, using: 1, stars: 10 },
      { id: 50100, getTime: 2, using: 1, unlock: 1 },
      { id: 50105, getTime: 4, using: 0 },
      { id: 50100, getTime: 3, using: 0 },
    ])).toEqual([
      { id: 50100, getTime: 2, using: 1 },
    ]);
  });

  it("仅修改 user 中的宠物数据", () => {
    const save: CloudSavePayload = {
      version: "3.4.2",
      serialized: 1,
      time: 100,
      modules: {
        user: {
          level: 8,
          gold: 20,
          refreshAnimalId: 50009,
          todayAnimalId: 50008,
          animals: [{ id: 50009, getTime: 1, using: 1 }],
        },
        settings: { music: 1 },
      },
    };
    const result = cleanupLegacyPetState(save);
    expect(result.changed).toBe(true);
    expect(result.removedAnimalCount).toBe(1);
    expect(result.removedLegacyFieldCount).toBe(2);
    expect(result.save).toEqual({
      ...save,
      modules: {
        ...save.modules,
        user: { level: 8, gold: 20, animals: [] },
      },
    });
  });

  it("无旧宠物数据时保持原对象", () => {
    const save: CloudSavePayload = {
      version: "3.4.2",
      serialized: 1,
      time: 100,
      modules: { user: { animals: [{ id: 50100, getTime: 2, using: 1 }] } },
    };
    const result = cleanupLegacyPetState(save);
    expect(result.changed).toBe(false);
    expect(result.save).toBe(save);
  });
});
