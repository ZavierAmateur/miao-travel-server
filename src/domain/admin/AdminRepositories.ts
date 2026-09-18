import type { AdminAuditLog, AdminSession, AdminUser } from "./AdminModels.js";

export interface AdminUserRepository {
  findByAccount(account: string): Promise<AdminUser | undefined>;
  findById(id: string): Promise<AdminUser | undefined>;
  save(user: AdminUser): Promise<void>;
}

export interface AdminSessionRepository {
  findByTokenHash(tokenHash: string): Promise<AdminSession | undefined>;
  save(session: AdminSession): Promise<void>;
}

export interface AdminAuditRepository {
  append(log: AdminAuditLog): Promise<void>;
}
