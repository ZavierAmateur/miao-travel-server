import type { AdminAuditLog, AdminSession, AdminUser } from "../../domain/admin/AdminModels.js";
import type { AdminAuditRepository, AdminSessionRepository, AdminUserRepository } from "../../domain/admin/AdminRepositories.js";
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
