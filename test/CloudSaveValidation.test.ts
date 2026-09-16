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

  it("拒绝未列入白名单的模块", () => {
    expect(() => validateCloudSaveInput({
      ...validInput(),
      save: { ...validInput().save, modules: { admin: { enabled: true } } },
    })).toThrowError(/不允许的存档模块/);
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
