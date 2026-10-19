import { describe, expect, it } from "vitest";
import { createUploadObjectKey, uploadOriginalName } from "../src/domain/file/UploadObjectKey.js";

const timestamp = Date.UTC(2026, 9, 18, 16);

describe("后台上传对象名", () => {
  it.each([
    ["活动海报.final.PNG", "活动海报.final"],
    ["../../海报.png", "海报"],
    ["C:\\images\\海报.png", "海报"],
    ["  活动 : 海报?*.png", "活动___海报"],
    [".png", "png"],
    ["....png", "image"],
    ["海报\u0000\u202e.png", "海报"],
  ])("清理 %s 并保留可辨认的文件名", (filename, stem) => {
    expect(createUploadObjectKey(filename, timestamp, "unique-id")).toBe(`admin/uploads/${stem}_20261019_unique-id.webp`);
  });

  it("超长 Unicode 名称按字符截断，保留日期和 ID", () => {
    expect(createUploadObjectKey(`${"猫🐱".repeat(100)}.png`, timestamp, "id"))
      .toBe(`admin/uploads/${"猫🐱".repeat(40)}_20261019_id.webp`);
    expect(uploadOriginalName("C:\\images\\海报.png")).toBe("海报.png");
  });
});
