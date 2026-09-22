import { describe, expect, it } from "vitest";
import { CloudSaveValidationError } from "../src/domain/save/CloudSaveErrors.js";
import { MAX_SAVE_BYTES, validateCloudSaveInput } from "../src/domain/save/CloudSaveValidation.js";

function validInput() {
  return {
    baseRevision: 0,
    clientVersion: "3.4.2",
    clientSavedAt: 1_000,
    idempotencyKey: "save-request-0001",
    save: {
      version: "3.4.2",
      serialized: 1,
      time: 1_000,
      modules: { user: { level: 3 }, settings: { music: 1 } },
    },
  } as const;
}

describe("云存档输入校验", () => {
  it("对键顺序不同的同一存档生成相同哈希", () => {
    const first = validateCloudSaveInput(validInput());
    const second = validateCloudSaveInput({
      ...validInput(),
      save: {
        time: 1_000,
        modules: { settings: { music: 1 }, user: { level: 3 } },
        serialized: 1,
        version: "3.4.2",
      },
    });
    expect(first.hash).toBe(second.hash);
  });

  it("兼容接收旧五模块请求但只保留 V1 user", () => {
    const validated = validateCloudSaveInput(validInput());
    expect(validated.save.modules).toEqual({ user: { level: 3 } });
    expect(validated.sizeBytes).toBeLessThan(MAX_SAVE_BYTES);
  });

  it("只保留 V1 user 字段白名单，旧客户端字段不会重新写回", () => {
    const validated = validateCloudSaveInput({
      ...validInput(),
      save: {
        ...validInput().save,
        modules: {
          user: {
            level: 3,
            energy: 9,
            nickName: "不再上云",
            todayPlayCount: 8,
            interstitialAdTimer: 123,
          },
        },
      },
    });
    expect(validated.save.modules.user).toEqual({ level: 3, energy: 9 });
  });

  it("拒绝不包含 user 的旧模块存档", () => {
    expect(() => validateCloudSaveInput({
      ...validInput(),
      save: { ...validInput().save, modules: { settings: { music: 1 } } },
    })).toThrowError(/必须包含 user 对象/);
  });

  it("拒绝未列入白名单的模块", () => {
    expect(() => validateCloudSaveInput({
      ...validInput(),
      save: { ...validInput().save, modules: { admin: { enabled: true } } },
    })).toThrowError(/不允许的存档模块/);
  });

  it("拒绝无法用于闯关榜的非法关卡", () => {
    for (const level of [0, 1.5, 1_000_001]) {
      expect(() => validateCloudSaveInput({
        ...validInput(),
        save: { ...validInput().save, modules: { user: { level } } },
      })).toThrowError(/user\.level/);
    }
  });

  it("拒绝危险原型字段", () => {
    const modules = JSON.parse('{"user":{"__proto__":{"polluted":true}}}') as object;
    expect(() => validateCloudSaveInput({
      ...validInput(),
      save: { ...validInput().save, modules },
    })).toThrowError(/危险字段/);
  });

  it("拒绝超过 512 KiB 的存档", () => {
    try {
      validateCloudSaveInput({
        ...validInput(),
        save: { ...validInput().save, modules: { user: { text: "x".repeat(MAX_SAVE_BYTES) } } },
      });
      throw new Error("应当拒绝超限存档");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudSaveValidationError);
      expect((error as CloudSaveValidationError).code).toBe("SAVE_TOO_LARGE");
    }
  });
});
