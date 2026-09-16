import { describe, expect, it } from "vitest";
import { isMissingCollection, isMissingDocument } from "../scripts/cloudbase-probe-errors.js";

describe("CloudBase 探测错误识别", () => {
  it("将缺少探针文档视为集合已存在", () => {
    const error = { code: "DOCUMENT_NOT_FOUND", message: "Document not found" };

    expect(isMissingDocument(error)).toBe(true);
    expect(isMissingCollection(error)).toBe(false);
  });

  it("识别集合不存在错误", () => {
    const error = { code: "DATABASE_COLLECTION_NOT_EXIST", message: "Collection not exist" };

    expect(isMissingDocument(error)).toBe(false);
    expect(isMissingCollection(error)).toBe(true);
  });

  it("不吞掉未知数据库错误", () => {
    const error = { code: "PERMISSION_DENIED", message: "Permission denied" };

    expect(isMissingDocument(error)).toBe(false);
    expect(isMissingCollection(error)).toBe(false);
  });
});
