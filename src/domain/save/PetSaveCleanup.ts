import type { CloudSavePayload, JsonValue } from "./CloudSave.js";

/** 开发阶段只允许默认宠物；50101–50107 仅展示锁定态，不进入持有记录。 */
export const CURRENT_PET_IDS = new Set([50100]);

export interface PetSaveCleanupResult {
  readonly save: CloudSavePayload;
  readonly changed: boolean;
  readonly removedAnimalCount: number;
  readonly removedLegacyFieldCount: number;
}

/** 只保留现行宠物 ID 和纯持有字段。 */
export function normalizeCurrentPetRecords(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<number>();
  const result: JsonValue[] = [];
  let hasUsingAnimal = false;
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = item.id;
    if (!Number.isSafeInteger(id) || !CURRENT_PET_IDS.has(id as number) || ids.has(id as number)) continue;
    ids.add(id as number);
    const using = item.using === 1 && !hasUsingAnimal ? 1 : 0;
    if (using === 1) hasUsingAnimal = true;
    result.push({
      id: id as number,
      getTime: Number.isSafeInteger(item.getTime) && (item.getTime as number) >= 0 ? item.getTime as number : 0,
      using,
    });
  }
  return result;
}

/**
 * 只清理云存档中的旧宠物数据，不改动关卡、资源或其他业务字段。
 */
export function cleanupLegacyPetState(save: CloudSavePayload): PetSaveCleanupResult {
  const user = save.modules.user;
  if (!isPlainObject(user)) {
    return { save, changed: false, removedAnimalCount: 0, removedLegacyFieldCount: 0 };
  }

  const nextUser: Record<string, JsonValue> = { ...user };
  let changed = false;
  let removedAnimalCount = 0;
  let removedLegacyFieldCount = 0;

  for (const field of ["refreshAnimalId", "todayAnimalId"]) {
    if (Object.prototype.hasOwnProperty.call(nextUser, field)) {
      delete nextUser[field];
      changed = true;
      removedLegacyFieldCount += 1;
    }
  }

  if (Object.prototype.hasOwnProperty.call(nextUser, "animals")) {
    const rawAnimals = nextUser.animals ?? null;
    const sourceAnimals = Array.isArray(rawAnimals) ? rawAnimals : [];
    const animals = normalizeCurrentPetRecords(rawAnimals);
    removedAnimalCount = Math.max(0, sourceAnimals.length - animals.length);
    if (JSON.stringify(nextUser.animals) !== JSON.stringify(animals)) {
      nextUser.animals = animals;
      changed = true;
    }
  }

  if (!changed) {
    return { save, changed, removedAnimalCount, removedLegacyFieldCount };
  }
  return {
    save: {
      ...save,
      modules: {
        ...save.modules,
        user: nextUser,
      },
    },
    changed,
    removedAnimalCount,
    removedLegacyFieldCount,
  };
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
