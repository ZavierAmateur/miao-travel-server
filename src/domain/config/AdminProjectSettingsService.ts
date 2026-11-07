import { randomUUID } from "node:crypto";
import { AdminPermission } from "../admin/AdminAccess.js";
import type { AdminAuthService } from "../admin/AdminAuthService.js";
import type { AdminAuditRepository } from "../admin/AdminRepositories.js";
import { DEFAULT_BOOTSTRAP_CONFIG, validateBootstrapConfigRecord, type BootstrapConfigRecord } from "./BootstrapConfig.js";
import type { BootstrapConfigRepository } from "./BootstrapConfigRepository.js";

export class AdminProjectSettingsError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message); this.name = "AdminProjectSettingsError";
  }
}
export interface VersionSettingsInput {
  readonly expectedRevision: number;
  readonly latestClientVersion: string;
  readonly minimumClientVersion: string;
}
export class AdminProjectSettingsService {
  constructor(private readonly options: {
    readonly auth: AdminAuthService;
    readonly repository: BootstrapConfigRepository;
    readonly audits: AdminAuditRepository;
    readonly now?: () => number;
  }) {}

  async getVersionControl(token: string | undefined) {
    await this.requirePermission(token, AdminPermission.ConfigRead);
    return this.toData(await this.current());
  }

  async updateVersionControl(token: string | undefined, input: VersionSettingsInput, context: { requestId: string; ip: string }) {
    const identity = await this.requirePermission(token, AdminPermission.ConfigPublish);
    const current = await this.current();
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new AdminProjectSettingsError("INVALID_VERSION_SETTINGS", "配置版本无效，请重新加载", 400);
    }
    if (input.expectedRevision !== current.revision) throw this.conflict();
    let next: BootstrapConfigRecord;
    try {
      next = validateBootstrapConfigRecord({ ...current,
        latestClientVersion: input.latestClientVersion.trim(), minimumClientVersion: input.minimumClientVersion.trim(),
        revision: current.revision + 1, updatedAt: (this.options.now ?? Date.now)(), updatedBy: identity.account,
      });
    } catch (error) {
      throw new AdminProjectSettingsError("INVALID_VERSION_SETTINGS", error instanceof Error ? error.message : "版本设置无效", 400);
    }
    if ((current.latestClientVersion ?? "") === next.latestClientVersion && current.minimumClientVersion === next.minimumClientVersion) {
      return this.toData(current);
    }
    if (!await this.options.repository.compareAndSet(current.revision, next)) throw this.conflict();
    try {
      await this.options.audits.append({ id: randomUUID(), adminUserId: identity.id, action: "project.version.update",
        requestId: context.requestId, ip: context.ip, createdAt: next.updatedAt,
        metadata: { revision: next.revision, latestClientVersion: next.latestClientVersion ?? "", minimumClientVersion: next.minimumClientVersion,
          previousLatestClientVersion: current.latestClientVersion ?? "", previousMinimumClientVersion: current.minimumClientVersion },
      });
    } catch {
      throw new AdminProjectSettingsError("PROJECT_SETTINGS_AUDIT_FAILED", "设置已保存，但操作记录写入失败，请重新加载确认", 503);
    }
    return this.toData(next);
  }
  private async requirePermission(token: string | undefined, permission: AdminPermission) {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(permission)) {
      throw new AdminProjectSettingsError("ADMIN_PERMISSION_DENIED", "当前账号无权发布版本设置", 403);
    }
    return identity;
  }
  private async current(): Promise<BootstrapConfigRecord> {
    return validateBootstrapConfigRecord(await this.options.repository.find() ?? DEFAULT_BOOTSTRAP_CONFIG);
  }
  private conflict() {
    return new AdminProjectSettingsError("PROJECT_SETTINGS_CONFLICT", "设置已被其他人修改，请重新加载后核对再保存", 409);
  }
  private toData(config: BootstrapConfigRecord) {
    return { revision: config.revision, latestClientVersion: config.latestClientVersion ?? "", minimumClientVersion: config.minimumClientVersion,
      updatedAt: config.updatedAt, updatedBy: config.updatedBy };
  }
}
