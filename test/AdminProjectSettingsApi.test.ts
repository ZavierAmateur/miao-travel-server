import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AdminProjectSettingsService } from "../src/domain/config/AdminProjectSettingsService.js";
import { BootstrapConfigService } from "../src/domain/config/BootstrapConfigService.js";
import { InMemoryBootstrapConfigRepository } from "../src/infrastructure/repositories/InMemoryBootstrapConfigRepository.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";

const config: AppConfig = { environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "app", appSecret: "test", logLevel: "error", persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "", cloudbaseRegion: "", cloudbaseApiKey: "", cloudbaseDatabaseInstance: "", cloudDatabaseName: "" };
const adminConfig = { enabled: true, bootstrapAccount: "root.admin", bootstrapPassword: "correct-password-123",
  bootstrapDisplayName: "超管", webOrigin: "http://127.0.0.1:5173", secureCookie: false };
const input = { expectedRevision: 3, latestClientVersion: "1.3.0", minimumClientVersion: "1.2.0" };
describe("项目设置版本控制API", () => {
  let app: FastifyInstance, cookie: string, users: InMemoryAdminUserRepository, audits: InMemoryAdminAuditRepository;
  let repository: InMemoryBootstrapConfigRepository;
  let auth: AdminAuthService;
  beforeEach(async () => {
    users = new InMemoryAdminUserRepository(); audits = new InMemoryAdminAuditRepository();
    auth = new AdminAuthService({ users, sessions: new InMemoryAdminSessionRepository(), audits, now: () => 20000, createToken: () => "settings-token" });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超管");
    repository = new InMemoryBootstrapConfigRepository({ revision: 3, latestClientVersion: "1.2.0", minimumClientVersion: "1.1.0",
      maintenanceEnabled: true, maintenanceMessage: "保留维护", cloudSaveEnabled: false, updatedAt: 1000, updatedBy: "old" });
    const settings = new AdminProjectSettingsService({ auth, repository, audits, now: () => 20000 });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, adminProjectSettingsService: settings,
      bootstrapConfigService: new BootstrapConfigService(repository), now: () => 20000 });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const raw = login.headers["set-cookie"]!; cookie = (Array.isArray(raw) ? raw[0]! : raw).split(";")[0]!;
  });
  afterEach(async () => app.close());
  const url = "/admin/v1/project-settings/version-control";
  it("读取版本设置需登录，响应不缓存，运营可看但不能保存生效", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url, payload: input })).statusCode).toBe(401);
    const admin = await users.findByAccount("root.admin"); await users.save({ ...admin!, role: "operator" });
    const read = await app.inject({ method: "GET", url, headers: { cookie } });
    expect(read.statusCode).toBe(200); expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.json()).toMatchObject({ data: { revision: 3, latestClientVersion: "1.2.0", minimumClientVersion: "1.1.0" } });
    expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload: input })).statusCode).toBe(403);
  });
  it("保存只变版本字段，递增版本和审计，冷启动公共接口读到同一规则", async () => {
    const saved = await app.inject({ method: "PUT", url, headers: { cookie }, payload: input });
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ data: { revision: 4, latestClientVersion: "1.3.0", updatedAt: 20000 } });
    expect(await repository.find()).toMatchObject({ maintenanceEnabled: true, maintenanceMessage: "保留维护", cloudSaveEnabled: false, revision: 4 });
    const response = await app.inject({ method: "GET", url: "/v1/bootstrap-config" });
    expect(response.json()).toMatchObject({ data: { latestClientVersion: "1.3.0", minimumClientVersion: "1.2.0" } });
    const audit = audits.logs.find(log => log.action === "project.version.update");
    expect(audit?.metadata?.revision).toBe(4);
  });
  it("非法版本、反向范围、未知字段及不受信任来源不会修改设置", async () => {
    for (const payload of [ { ...input, latestClientVersion: "v1.3" }, { ...input, minimumClientVersion: "2.0.0" }, { ...input, maintenanceEnabled: false } ]) {
      expect((await app.inject({ method: "PUT", url, headers: { cookie }, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url, headers: { cookie, origin: "https://evil.example" }, payload: input })).statusCode).toBe(403);
    expect((await repository.find())?.revision).toBe(3);
  });
  it("并发保存只有一个成功，旧表单返回409且不覆盖已保存规则", async () => {
    const results = await Promise.all([app.inject({ method: "PUT", url, headers: { cookie }, payload: input }),
      app.inject({ method: "PUT", url, headers: { cookie }, payload: { ...input, latestClientVersion: "1.4.0" } })]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    expect((await repository.find())?.revision).toBe(4);
    expect(audits.logs.filter(log => log.action === "project.version.update")).toHaveLength(1);
  });
  it("首次保存可初始化但不能重复创建，空值可撤销版本要求", async () => {
    const empty = new InMemoryBootstrapConfigRepository();
    const settings = new AdminProjectSettingsService({ auth, repository: empty, audits, now: () => 20000 });
    const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    await expect(settings.getVersionControl(token)).resolves.toMatchObject({ revision: 0, latestClientVersion: "", minimumClientVersion: "" });
    const first = { expectedRevision: 0, latestClientVersion: "1.0.0", minimumClientVersion: "" };
    await expect(settings.updateVersionControl(token, first, { requestId: "first", ip: "local" })).resolves.toMatchObject({ revision: 1 });
    await expect(settings.updateVersionControl(token, first, { requestId: "again", ip: "local" })).rejects.toMatchObject({ statusCode: 409 });
    const saved = await app.inject({ method: "PUT", url, headers: { cookie }, payload: { expectedRevision: 3, latestClientVersion: "", minimumClientVersion: "" } });
    expect(saved.statusCode).toBe(200); expect((await repository.find())?.minimumClientVersion).toBe("");
  });
  it("设置已写入但审计失败时明确告知已保存，不误导用户以为规则未生效", async () => {
    vi.spyOn(audits, "append").mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await app.inject({ method: "PUT", url, headers: { cookie }, payload: input });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string; msg: string }>()).toMatchObject({ code: "PROJECT_SETTINGS_AUDIT_FAILED" });
    expect(response.json<{ msg: string }>().msg).toContain("设置已保存");
    expect((await repository.find())?.revision).toBe(4);
  });

});
