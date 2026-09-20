import type { AdminAuditLog, AdminErrorLog, AdminSession, AdminUser } from "../../domain/admin/AdminModels.js";
import type { AdminAuditRepository, AdminErrorLogRepository, AdminSessionRepository, AdminUserRepository } from "../../domain/admin/AdminRepositories.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

export class CloudBaseAdminUserRepository implements AdminUserRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}
  async findByAccount(account: string): Promise<AdminUser | undefined> {
    const result = await this.collection.where({ account }).get();
    return toAdminUser(result.data[0]);
  }
  async findById(id: string): Promise<AdminUser | undefined> {
    try {
      const result = await this.collection.doc(id).get();
      return toAdminUser(result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }
  async save(user: AdminUser): Promise<void> { await this.collection.doc(user.id).set(user); }
}

export class CloudBaseAdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}
  async findByTokenHash(tokenHash: string): Promise<AdminSession | undefined> {
    try {
      const result = await this.collection.doc(tokenHash).get();
      return toAdminSession(tokenHash, result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }
  async save(session: AdminSession): Promise<void> { await this.collection.doc(session.tokenHash).set(session); }
}

export class CloudBaseAdminAuditRepository implements AdminAuditRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}
  async append(log: AdminAuditLog): Promise<void> { await this.collection.doc(log.id).set(log); }
}

export class CloudBaseAdminErrorLogRepository implements AdminErrorLogRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}
  async append(log: AdminErrorLog): Promise<void> {
    await this.collection.doc(log.id).set({
      id: log.id,
      occurredAt: log.occurredAt,
      requestId: log.requestId,
      method: log.method,
      path: log.path,
      statusCode: log.statusCode,
      errorCode: log.code,
      safeMessage: log.message,
      errorName: log.errorName,
    });
  }
  async findById(id: string): Promise<AdminErrorLog | undefined> {
    try {
      const result = await this.collection.doc(id).get();
      return toAdminErrorLog(result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }
  async listRecent(offset: number, limit: number): Promise<readonly AdminErrorLog[]> {
    const result = await this.collection.where({})
      .orderBy("occurredAt", "desc")
      .skip(offset)
      .limit(limit)
      .get();
    return result.data.flatMap((value) => {
      const log = toAdminErrorLog(value);
      return log ? [log] : [];
    });
  }
}

function toAdminUser(value: unknown): AdminUser | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const document = value as AdminUser;
  return {
    id: document.id,
    account: document.account,
    passwordHash: document.passwordHash,
    displayName: document.displayName,
    role: document.role,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...(document.lastLoginAt === undefined ? {} : { lastLoginAt: document.lastLoginAt }),
  };
}

function toAdminSession(tokenHash: string, value: unknown): AdminSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const document = value as AdminSession;
  return {
    tokenHash,
    adminUserId: document.adminUserId,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    ...(document.revokedAt === undefined ? {} : { revokedAt: document.revokedAt }),
  };
}

function toAdminErrorLog(value: unknown): AdminErrorLog | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const document = value as {
    readonly id?: unknown;
    readonly occurredAt?: unknown;
    readonly requestId?: unknown;
    readonly method?: unknown;
    readonly path?: unknown;
    readonly statusCode?: unknown;
    readonly errorCode?: unknown;
    readonly safeMessage?: unknown;
    readonly errorName?: unknown;
  };
  if (typeof document.id !== "string" || typeof document.requestId !== "string"
    || typeof document.occurredAt !== "number" || typeof document.method !== "string"
    || typeof document.path !== "string" || typeof document.statusCode !== "number"
    || typeof document.errorCode !== "string" || typeof document.safeMessage !== "string"
    || typeof document.errorName !== "string") return undefined;
  return {
    id: document.id,
    occurredAt: document.occurredAt,
    requestId: document.requestId,
    method: document.method,
    path: document.path,
    statusCode: document.statusCode,
    code: document.errorCode,
    message: document.safeMessage,
    errorName: document.errorName,
  };
}
