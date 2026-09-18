import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";

const config: AppConfig = {
  environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "test-app", appSecret: "test-secret",
  logLevel: "error", persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "", cloudbaseRegion: "", cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "", cloudDatabaseName: "",
};

const adminConfig: AdminAuthConfig = {
  enabled: true,
  bootstrapAccount: "root.admin",
  bootstrapPassword: "correct-password-123",
  bootstrapDisplayName: "超级管理员",
  webOrigin: "http://127.0.0.1:5173",
  secureCookie: false,
};

describe("管理员认证 API", () => {
  let app: FastifyInstance | undefined;
  let service: AdminAuthService;

  beforeEach(async () => {
    service = new AdminAuthService({
      users: new InMemoryAdminUserRepository(),
      sessions: new InMemoryAdminSessionRepository(),
      audits: new InMemoryAdminAuditRepository(),
      now: () => 10_000,
      createToken: () => "admin-session-token",
    });
    await service.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    app = buildApp({ config, adminAuthService: service, adminAuthConfig: adminConfig, now: () => 10_000 });
  });

  afterEach(async () => app?.close());

  it("登录后只通过 HttpOnly Cookie 返回会话并给出双角色权限", async () => {
    const response = await app!.inject({
      method: "POST", url: "/admin/v1/auth/login",
      headers: { origin: adminConfig.webOrigin, "x-request-id": "admin-login-1" },
      payload: { account: "ROOT.ADMIN", password: "correct-password-123" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(adminConfig.webOrigin);
    expect(response.headers["set-cookie"]).toContain("miao_admin_session=admin-session-token");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    const body = response.json<{ data: { identity: { role: string; displayName: string; permissions: string[] } } }>();
    expect(body.data.identity).toMatchObject({ role: "admin", displayName: "超级管理员" });
    expect(body.data.identity.permissions).toContain("admin:manage");
    expect(response.body).not.toContain("admin-session-token");
  });

  it("可读取当前会话并在退出后撤销", async () => {
    const login = await app!.inject({ method: "POST", url: "/admin/v1/auth/login", payload: {
      account: "root.admin", password: "correct-password-123",
    } });
    const setCookie = login.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const me = await app!.inject({ method: "GET", url: "/admin/v1/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const meBody = me.json<{ data: { identity: { role: string } } }>();
    expect(meBody.data.identity.role).toBe("admin");

    const logout = await app!.inject({ method: "POST", url: "/admin/v1/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const afterLogout = await app!.inject({ method: "GET", url: "/admin/v1/auth/me", headers: { cookie } });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json<{ code: string }>().code).toBe("ADMIN_SESSION_INVALID");
  });

  it("错误密码返回统一错误且不暴露账号是否存在", async () => {
    const response = await app!.inject({ method: "POST", url: "/admin/v1/auth/login", payload: {
      account: "root.admin", password: "wrong-password",
    } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "ADMIN_CREDENTIALS_INVALID", msg: "账号或密码错误" });
  });

  it("拒绝来自非管理后台域名的写请求", async () => {
    const response = await app!.inject({
      method: "POST", url: "/admin/v1/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { account: "root.admin", password: "correct-password-123" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("ADMIN_ORIGIN_FORBIDDEN");
  });

  it("开发环境允许 localhost 与 127.0.0.1 同端口回环地址互换", async () => {
    const response = await app!.inject({
      method: "POST", url: "/admin/v1/auth/login",
      headers: { origin: "http://localhost:5173" },
      payload: { account: "root.admin", password: "correct-password-123" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

});
