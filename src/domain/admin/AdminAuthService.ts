import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AdminRole, permissionsForRole } from "./AdminAccess.js";
import { AdminAuthError } from "./AdminAuthErrors.js";
import { hashAdminPassword, verifyAdminPassword } from "./AdminPassword.js";
import type { AdminAuditRepository, AdminSessionRepository, AdminUserRepository } from "./AdminRepositories.js";
import type { AdminUser } from "./AdminModels.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;

export interface AdminAuthServiceOptions {
  readonly users: AdminUserRepository;
  readonly sessions: AdminSessionRepository;
  readonly audits: AdminAuditRepository;
  readonly now?: () => number;
  readonly createToken?: () => string;
}

export class AdminAuthService {
  private readonly now: () => number;
  private readonly createToken: () => string;
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly options: AdminAuthServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async ensureBootstrapAdmin(account: string, password: string, displayName: string): Promise<void> {
    const normalized = normalizeAccount(account);
    if (password.length < 12) throw new Error("ADMIN_BOOTSTRAP_PASSWORD 至少需要 12 个字符");
    if (await this.options.users.findByAccount(normalized)) return;
    const now = this.now();
    await this.options.users.save({
      id: adminId(normalized),
      account: normalized,
      passwordHash: await hashAdminPassword(password),
      displayName: displayName.trim() || "超级管理员",
      role: AdminRole.Admin,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  async login(account: string, password: string, context: { requestId: string; ip: string }) {
    const normalized = normalizeAccount(account);
    const failureKey = `${context.ip}:${normalized}`;
    this.assertNotRateLimited(failureKey);
    const user = await this.options.users.findByAccount(normalized);
    if (!user || !(await verifyAdminPassword(password, user.passwordHash))) {
      this.recordFailure(failureKey);
      throw new AdminAuthError("ADMIN_CREDENTIALS_INVALID", "账号或密码错误", 401);
    }
    if (user.status !== "active") throw new AdminAuthError("ADMIN_ACCOUNT_DISABLED", "管理员账号已停用", 403);
    this.failures.delete(failureKey);

    const now = this.now();
    const token = this.createToken();
    await this.options.sessions.save({
      tokenHash: hashToken(token),
      adminUserId: user.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    await this.options.users.save({ ...user, lastLoginAt: now, updatedAt: now });
    await this.options.audits.append({
      id: randomUUID(), adminUserId: user.id, action: "admin.login",
      requestId: context.requestId, ip: context.ip, createdAt: now,
    });
    return { token, expiresAt: now + SESSION_TTL_MS, identity: toIdentity(user) };
  }

  async authenticate(token?: string) {
    if (!token) throw new AdminAuthError("ADMIN_AUTH_REQUIRED", "缺少管理员会话", 401);
    const session = await this.options.sessions.findByTokenHash(hashToken(token));
    if (!session || session.revokedAt !== undefined) {
      throw new AdminAuthError("ADMIN_SESSION_INVALID", "管理员会话无效", 401);
    }
    if (session.expiresAt <= this.now()) {
      throw new AdminAuthError("ADMIN_SESSION_EXPIRED", "管理员会话已过期", 401);
    }
    const user = await this.options.users.findById(session.adminUserId);
    if (!user) throw new AdminAuthError("ADMIN_SESSION_INVALID", "管理员会话无效", 401);
    if (user.status !== "active") throw new AdminAuthError("ADMIN_ACCOUNT_DISABLED", "管理员账号已停用", 403);
    return { session, identity: toIdentity(user) };
  }

  async logout(token: string | undefined, context: { requestId: string; ip: string }): Promise<void> {
    const authenticated = await this.authenticate(token);
    await this.options.sessions.save({ ...authenticated.session, revokedAt: this.now() });
    await this.options.audits.append({
      id: randomUUID(), adminUserId: authenticated.identity.id, action: "admin.logout",
      requestId: context.requestId, ip: context.ip, createdAt: this.now(),
    });
  }

  private assertNotRateLimited(key: string): void {
    const threshold = this.now() - FAILURE_WINDOW_MS;
    const active = (this.failures.get(key) ?? []).filter((time) => time > threshold);
    this.failures.set(key, active);
    if (active.length >= MAX_FAILURES) {
      throw new AdminAuthError("ADMIN_LOGIN_RATE_LIMITED", "登录失败次数过多，请稍后重试", 429);
    }
  }

  private recordFailure(key: string): void {
    this.failures.set(key, [...(this.failures.get(key) ?? []), this.now()]);
  }
}

function normalizeAccount(account: string): string {
  const normalized = account.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) return normalized;
  return normalized;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function adminId(account: string): string {
  return createHash("sha256").update(`miao-admin:${account}`).digest("hex").slice(0, 32);
}

function toIdentity(user: AdminUser) {
  return {
    id: user.id,
    account: user.account,
    displayName: user.displayName,
    role: user.role,
    permissions: permissionsForRole(user.role),
  } as const;
}
