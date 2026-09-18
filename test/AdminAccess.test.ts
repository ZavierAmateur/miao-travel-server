import { describe, expect, it } from "vitest";
import { AdminRole, permissionsForRole } from "../src/domain/admin/AdminAccess.js";

describe("管理员双角色权限", () => {
  it("operator 可运营但不能管理管理员或执行最高风险操作", () => {
    const permissions = permissionsForRole(AdminRole.Operator);
    expect(permissions).toContain("player:read");
    expect(permissions).toContain("config:write");
    expect(permissions).not.toContain("admin:manage");
    expect(permissions).not.toContain("save:rollback");
    expect(permissions).not.toContain("config:publish");
  });

  it("admin 拥有全部已定义权限", () => {
    const permissions = permissionsForRole(AdminRole.Admin);
    expect(permissions).toContain("admin:manage");
    expect(permissions).toContain("save:rollback");
    expect(permissions).toContain("config:publish");
  });
});
