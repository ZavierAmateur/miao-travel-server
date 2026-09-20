import type { AdminAuditLog, AdminErrorLog, AdminSession, AdminUser } from "./AdminModels.js";

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

export interface AdminErrorLogRepository {
  append(log: AdminErrorLog): Promise<void>;
  findById(id: string): Promise<AdminErrorLog | undefined>;
  listRecent(offset: number, limit: number): Promise<readonly AdminErrorLog[]>;
}
