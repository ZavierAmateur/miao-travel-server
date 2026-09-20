import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AdminErrorLogService } from "../src/domain/admin/AdminErrorLogService.js";
import { AdminPlayerService } from "../src/domain/admin/AdminPlayerService.js";
import {
  InMemoryAdminAuditRepository,
  InMemoryAdminErrorLogRepository,
  InMemoryAdminSessionRepository,
  InMemoryAdminUserRepository,
} from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";
import { InMemoryCloudSaveRepository } from "../src/infrastructure/repositories/InMemoryCloudSaveRepository.js";
import { InMemoryPlayerProfileRepository } from "../src/infrastructure/repositories/InMemoryPlayerProfileRepository.js";
import { InMemoryPlayerRepository } from "../src/infrastructure/repositories/InMemoryPlayerRepository.js";

const config: AppConfig = {
  environment: AppEnvironment.Test, host: "127.0.0.1", port: 3000,
  platform: PlatformKind.WeChat, appId: "test-app", appSecret: "test-secret",
  logLevel: "error", persistenceDriver: PersistenceDriver.Memory,
  cloudbaseEnvId: "", cloudbaseRegion: "", cloudbaseApiKey: "",
  cloudbaseDatabaseInstance: "", cloudDatabaseName: "",
};

const adminConfig: AdminAuthConfig = {
  enabled: true, bootstrapAccount: "root.admin", bootstrapPassword: "correct-password-123",
  bootstrapDisplayName: "超级管理员", webOrigin: "http://127.0.0.1:5173", secureCookie: false,
};

describe("管理端错误日志 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;
  let logs: InMemoryAdminErrorLogRepository;

  beforeEach(async () => {
    const users = new InMemoryAdminUserRepository();
    const audits = new InMemoryAdminAuditRepository();
    const auth = new AdminAuthService({
      users, sessions: new InMemoryAdminSessionRepository(), audits,
      now: () => 30_000, createToken: () => "error-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    logs = new InMemoryAdminErrorLogRepository();
    let sequence = 0;
    const errors = new AdminErrorLogService({
      auth, logs, now: () => 30_000, createId: () => `error-${++sequence}`,
    });
    const players = new AdminPlayerService({
      auth,
      players: new InMemoryPlayerRepository(),
      profiles: new InMemoryPlayerProfileRepository(),
      saves: new InMemoryCloudSaveRepository(),
      audits,
      now: () => 30_000,
    });
    app = buildApp({
      config,
      adminAuthService: auth,
      adminAuthConfig: adminConfig,
      adminPlayerService: players,
      adminErrorLogService: errors,
      now: () => 30_000,
    });
    const login = await app.inject({
      method: "POST", url: "/admin/v1/auth/login",
      payload: { account: "root.admin", password: "correct-password-123" },
    });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("自动记录脱敏错误并按业务码和 requestId 查询详情", async () => {
    const failed = await app!.inject({
      method: "GET",
      url: "/admin/v1/players?cursor=broken",
      headers: { cookie, "x-request-id": "error-request-1" },
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json()).toMatchObject({ code: "INVALID_CURSOR", requestId: "error-request-1" });

    const listed = await app!.inject({
      method: "GET",
      url: "/admin/v1/errors?code=INVALID_CURSOR&requestId=error-request-1&from=29999&to=30001",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ data: { items: [{
      id: "error-1",
      occurredAt: 30_000,
      requestId: "error-request-1",
      method: "GET",
      path: "/admin/v1/players",
      statusCode: 400,
      code: "INVALID_CURSOR",
      message: "分页游标无效",
      errorName: "AdminPlayerError",
    }], nextCursor: null } });

    const detail = await app!.inject({ method: "GET", url: "/admin/v1/errors/error-1", headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ data: { id: "error-1", requestId: "error-request-1" } });
    expect(JSON.stringify(logs.logs)).not.toContain("correct-password-123");
    expect(JSON.stringify(logs.logs)).not.toContain("error-admin-token");
  });

  it("拒绝未登录访问并校验筛选时间和日志 ID", async () => {
    const anonymous = await app!.inject({ method: "GET", url: "/admin/v1/errors" });
    expect(anonymous.statusCode).toBe(401);
    expect(logs.logs).toHaveLength(0);

    const invalidRange = await app!.inject({
      method: "GET", url: "/admin/v1/errors?from=30001&to=30000", headers: { cookie },
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json()).toMatchObject({ code: "INVALID_ERROR_QUERY" });

    const missing = await app!.inject({ method: "GET", url: "/admin/v1/errors/missing", headers: { cookie } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "ERROR_LOG_NOT_FOUND" });
  });
});
