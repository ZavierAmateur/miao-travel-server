import { randomUUID } from "node:crypto";
import type { PlatformKind } from "../../config/AppConfig.js";
import { AdminPermission } from "../admin/AdminAccess.js";
import type { AdminIdentity } from "../admin/AdminAuthService.js";
import type { AdminAuthService } from "../admin/AdminAuthService.js";
import type { AdminAuditRepository } from "../admin/AdminRepositories.js";
import { AnnouncementStatus, type Announcement, type PutAnnouncementInput } from "./Announcement.js";
import { AnnouncementError } from "./AnnouncementErrors.js";
import type { AnnouncementRepository } from "./AnnouncementRepository.js";
import { announcementSummary, validateAnnouncementInput } from "./AnnouncementValidation.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface AnnouncementServiceOptions {
  readonly repository: AnnouncementRepository;
  readonly auth?: AdminAuthService;
  readonly audits?: AdminAuditRepository;
  readonly now?: () => number;
}

export class AnnouncementService {
  private readonly now: () => number;

  constructor(private readonly options: AnnouncementServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async listPublic(query: { readonly platform: PlatformKind; readonly page?: number; readonly pageSize?: number }) {
    const currentTime = this.now();
    const records = (await this.options.repository.listAll())
      .filter((record) => record.status === AnnouncementStatus.Published)
      .filter((record) => record.platforms.includes(query.platform))
      .filter((record) => record.startsAt === 0 || record.startsAt <= currentTime)
      .filter((record) => record.endsAt === 0 || record.endsAt > currentTime)
      .sort(compareAnnouncements);
    return paginate(records.map(toPublicListItem), query.page, query.pageSize);
  }

  async getPublic(id: string, platform: PlatformKind) {
    const record = await this.options.repository.findById(id);
    if (!record || !isPubliclyVisible(record, platform, this.now())) {
      throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在", 404);
    }
    return toPublicDetail(record);
  }

  async listAdmin(token: string | undefined, query: {
    readonly page?: number;
    readonly pageSize?: number;
    readonly status?: Announcement["status"];
    readonly platform?: PlatformKind;
    readonly keyword?: string;
  }) {
    await this.requirePermission(token, AdminPermission.ConfigRead, "无权查看公告");
    const keyword = query.keyword?.trim().toLocaleLowerCase() ?? "";
    const records = (await this.options.repository.listAll())
      .filter((record) => !query.status || record.status === query.status)
      .filter((record) => !query.platform || record.platforms.includes(query.platform))
      .filter((record) => !keyword || record.title.toLocaleLowerCase().includes(keyword))
      .sort(compareAnnouncements);
    return paginate(records.map(toAdminListItem), query.page, query.pageSize);
  }

  async getAdmin(token: string | undefined, id: string) {
    await this.requirePermission(token, AdminPermission.ConfigRead, "无权查看公告");
    const record = await this.options.repository.findById(id);
    if (!record) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在", 404);
    return record;
  }

  async create(token: string | undefined, input: PutAnnouncementInput, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.ConfigWrite, "无权新增公告");
    const validated = validateAnnouncementInput(input);
    const timestamp = this.now();
    const record: Announcement = {
      id: randomUUID(),
      ...validated,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: identity.id,
      updatedBy: identity.id,
    };
    await this.options.repository.save(record);
    await this.audit(identity, "announcement.create", record, context);
    return record;
  }

  async update(token: string | undefined, id: string, input: PutAnnouncementInput, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.ConfigWrite, "无权更新公告");
    const current = await this.options.repository.findById(id);
    if (!current) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在", 404);
    const validated = validateAnnouncementInput(input);
    const record: Announcement = {
      ...current,
      ...validated,
      updatedAt: this.now(),
      updatedBy: identity.id,
    };
    await this.options.repository.save(record);
    await this.audit(identity, "announcement.update", record, context);
    return record;
  }

  async delete(token: string | undefined, id: string, context: { readonly requestId: string; readonly ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.ConfigWrite, "无权删除公告");
    const current = await this.options.repository.findById(id);
    if (!current) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在", 404);
    await this.options.repository.delete(id);
    await this.audit(identity, "announcement.delete", current, context);
    return { deleted: true, id };
  }

  private async requirePermission(token: string | undefined, permission: AdminPermission, message: string): Promise<AdminIdentity> {
    if (!this.options.auth) throw new AnnouncementError("ADMIN_SERVICE_UNAVAILABLE", "管理服务未启用", 503);
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(permission)) throw new AnnouncementError("ADMIN_PERMISSION_DENIED", message, 403);
    return identity;
  }

  private async audit(identity: AdminIdentity, action: "announcement.create" | "announcement.update" | "announcement.delete", record: Announcement, context: { readonly requestId: string; readonly ip: string }): Promise<void> {
    if (!this.options.audits) return;
    await this.options.audits.append({
      id: randomUUID(),
      adminUserId: identity.id,
      action,
      requestId: context.requestId,
      ip: context.ip,
      createdAt: this.now(),
      metadata: { announcementId: record.id, title: record.title, status: record.status },
    });
  }
}

function compareAnnouncements(left: Announcement, right: Announcement): number {
  return right.sortOrder - left.sortOrder || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
}

function isPubliclyVisible(record: Announcement, platform: PlatformKind, currentTime: number): boolean {
  return record.status === AnnouncementStatus.Published
    && record.platforms.includes(platform)
    && (record.startsAt === 0 || record.startsAt <= currentTime)
    && (record.endsAt === 0 || record.endsAt > currentTime);
}

function toPublicListItem(record: Announcement) {
  return {
    id: record.id,
    title: record.title,
    summary: announcementSummary(record.contentHtml),
    imageCount: record.images.length,
    autoPopup: record.autoPopup,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    updatedAt: record.updatedAt,
  };
}

function toPublicDetail(record: Announcement) {
  return {
    id: record.id,
    title: record.title,
    contentHtml: record.contentHtml,
    images: record.images,
    autoPopup: record.autoPopup,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    updatedAt: record.updatedAt,
  };
}

function toAdminListItem(record: Announcement) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    platforms: record.platforms,
    sortOrder: record.sortOrder,
    autoPopup: record.autoPopup,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    imageCount: record.images.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function paginate<T>(items: readonly T[], rawPage?: number, rawPageSize?: number) {
  const page = Math.max(1, rawPage ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize), page, pageSize, total: items.length };
}
