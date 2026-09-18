import type { AdminAuditLog, AdminSession, AdminUser } from "../../domain/admin/AdminModels.js";
import type { AdminAuditRepository, AdminSessionRepository, AdminUserRepository } from "../../domain/admin/AdminRepositories.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

export class CloudBaseAdminUserRepository implements AdminUserRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}
  async findByAccount(account: string): Promise<AdminUser | undefined> {
    const result = await this.collection.where({ account }).get();
    return result.data[0] as AdminUser | undefined;
  }
  async findById(id: string): Promise<AdminUser | undefined> {
    try {
      const result = await this.collection.doc(id).get();
      return result.data[0] as AdminUser | undefined;
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
      return result.data[0] as AdminSession | undefined;
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
