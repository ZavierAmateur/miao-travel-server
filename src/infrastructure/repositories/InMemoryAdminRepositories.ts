import type { AdminAuditLog, AdminErrorLog, AdminSession, AdminUser } from "../../domain/admin/AdminModels.js";
import type { AdminAuditRepository, AdminErrorLogRepository, AdminSessionRepository, AdminUserRepository } from "../../domain/admin/AdminRepositories.js";

export class InMemoryAdminUserRepository implements AdminUserRepository {
  private readonly users = new Map<string, AdminUser>();
  findByAccount(account: string): Promise<AdminUser | undefined> {
    return Promise.resolve([...this.users.values()].find((user) => user.account === account));
  }
  findById(id: string): Promise<AdminUser | undefined> { return Promise.resolve(this.users.get(id)); }
  save(user: AdminUser): Promise<void> { this.users.set(user.id, user); return Promise.resolve(); }
}

export class InMemoryAdminSessionRepository implements AdminSessionRepository {
  private readonly sessions = new Map<string, AdminSession>();
  findByTokenHash(tokenHash: string): Promise<AdminSession | undefined> { return Promise.resolve(this.sessions.get(tokenHash)); }
  save(session: AdminSession): Promise<void> { this.sessions.set(session.tokenHash, session); return Promise.resolve(); }
}

export class InMemoryAdminAuditRepository implements AdminAuditRepository {
  readonly logs: AdminAuditLog[] = [];
  append(log: AdminAuditLog): Promise<void> { this.logs.push(log); return Promise.resolve(); }
}

export class InMemoryAdminErrorLogRepository implements AdminErrorLogRepository {
  readonly logs: AdminErrorLog[] = [];
  append(log: AdminErrorLog): Promise<void> { this.logs.push(log); return Promise.resolve(); }
  findById(id: string): Promise<AdminErrorLog | undefined> {
    return Promise.resolve(this.logs.find((log) => log.id === id));
  }
  listRecent(offset: number, limit: number): Promise<readonly AdminErrorLog[]> {
    return Promise.resolve([...this.logs]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(offset, offset + limit));
  }
}
