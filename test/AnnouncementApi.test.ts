import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AppEnvironment, PersistenceDriver, PlatformKind, type AppConfig } from "../src/config/AppConfig.js";
import type { AdminAuthConfig } from "../src/config/AdminAuthConfig.js";
import { AdminAuthService } from "../src/domain/admin/AdminAuthService.js";
import { AnnouncementService } from "../src/domain/announcement/AnnouncementService.js";
import { InMemoryAdminAuditRepository, InMemoryAdminSessionRepository, InMemoryAdminUserRepository } from "../src/infrastructure/repositories/InMemoryAdminRepositories.js";
import { InMemoryAnnouncementRepository } from "../src/infrastructure/repositories/InMemoryAnnouncementRepository.js";

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

const validPayload = {
  title: "国庆旅行活动",
  contentHtml: "<p style=\"text-align:center\">欢迎旅行！</p>",
  images: [{
    fileId: "file-1", objectKey: "uploads/2026/09/file-1.webp",
    url: "https://miao.example/uploads/2026/09/file-1.webp", alt: "活动海报",
  }],
  status: "published" as const,
  platforms: ["wechat"] as const,
  sortOrder: 10,
  autoPopup: true,
  startsAt: 0,
  endsAt: 0,
};

describe("公告 API", () => {
  let app: FastifyInstance | undefined;
  let cookie: string;
  let audits: InMemoryAdminAuditRepository;

  beforeEach(async () => {
    audits = new InMemoryAdminAuditRepository();
    const auth = new AdminAuthService({
      users: new InMemoryAdminUserRepository(), sessions: new InMemoryAdminSessionRepository(), audits,
      now: () => 20_000, createToken: () => "announcement-admin-token",
    });
    await auth.ensureBootstrapAdmin("root.admin", "correct-password-123", "超级管理员");
    const announcements = new AnnouncementService({
      repository: new InMemoryAnnouncementRepository(), auth, audits, now: () => 20_000,
    });
    app = buildApp({ config, adminAuthService: auth, adminAuthConfig: adminConfig, announcementService: announcements, now: () => 20_000 });
    const login = await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { account: "root.admin", password: "correct-password-123" } });
    const setCookie = login.headers["set-cookie"]!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  });

  afterEach(async () => app?.close());

  it("管理员新增、分页查询、更新和删除公告并写入审计", async () => {
    const created = await app!.inject({ method: "POST", url: "/admin/v1/announcements", headers: { cookie }, payload: validPayload });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ data: { id: string } }>().data.id;

    const listed = await app!.inject({ method: "GET", url: "/admin/v1/announcements?page=1&pageSize=10&status=published&keyword=国庆", headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ data: { page: 1, pageSize: 10, total: 1, items: [{ id, title: "国庆旅行活动", imageCount: 1 }] } });
    expect(listed.body).not.toContain("contentHtml");

    const updated = await app!.inject({
      method: "PUT", url: `/admin/v1/announcements/${id}`, headers: { cookie },
      payload: { ...validPayload, title: "国庆旅行活动（更新）", status: "draft" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ data: { id, title: "国庆旅行活动（更新）", status: "draft" } });

    const deleted = await app!.inject({ method: "DELETE", url: `/admin/v1/announcements/${id}`, headers: { cookie } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ data: { deleted: true, id } });
    expect(audits.logs.map((log) => log.action)).toEqual(expect.arrayContaining([
      "announcement.create", "announcement.update", "announcement.delete",
    ]));
  });

  it("公共列表只返回当前平台已发布摘要，详情再返回富文本和图片", async () => {
    const created = await app!.inject({ method: "POST", url: "/admin/v1/announcements", headers: { cookie }, payload: validPayload });
    const id = created.json<{ data: { id: string } }>().data.id;
    await app!.inject({
      method: "POST", url: "/admin/v1/announcements", headers: { cookie },
      payload: { ...validPayload, title: "抖音公告", platforms: ["bytedance"] },
    });
    await app!.inject({
      method: "POST", url: "/admin/v1/announcements", headers: { cookie },
      payload: { ...validPayload, title: "草稿", status: "draft" },
    });

    const listed = await app!.inject({ method: "GET", url: "/v1/announcements?platform=wechat&page=1&pageSize=10" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ data: { total: 1, items: [{ id, title: "国庆旅行活动", summary: "欢迎旅行！", imageCount: 1 }] } });
    expect(listed.body).not.toContain("contentHtml");
    expect(listed.body).not.toContain("objectKey");

    const detail = await app!.inject({ method: "GET", url: `/v1/announcements/${id}?platform=wechat` });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json<{ data: { id: string; contentHtml: string; images: { alt: string }[] } }>();
    expect(detailBody.data.id).toBe(id);
    expect(detailBody.data.contentHtml).toContain("欢迎旅行");
    expect(detailBody.data.images).toMatchObject([{ alt: "活动海报" }]);

    const wrongPlatform = await app!.inject({ method: "GET", url: `/v1/announcements/${id}?platform=bytedance` });
    expect(wrongPlatform.statusCode).toBe(404);
  });

  it("清理危险富文本且拒绝未登录管理操作", async () => {
    const anonymous = await app!.inject({ method: "POST", url: "/admin/v1/announcements", payload: validPayload });
    expect(anonymous.statusCode).toBe(401);

    const created = await app!.inject({
      method: "POST", url: "/admin/v1/announcements", headers: { cookie },
      payload: {
        ...validPayload,
        contentHtml: "<script>alert(1)</script><p onclick=\"hack()\">安全正文<strong><u style=\"color:rgb(245, 108, 108);font-size:18px;position:fixed\">彩色重点</u></strong></p><img src=x>",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain("<script");
    expect(created.body).not.toContain("onclick");
    expect(created.body).not.toContain("<img");
    expect(created.body).not.toContain("position");
    expect(created.body).toContain("color:rgb(245, 108, 108)");
    expect(created.body).toContain("font-size:18px");
    expect(created.body).toContain("<strong><u");
    expect(created.body).toContain("安全正文");
  });
});
