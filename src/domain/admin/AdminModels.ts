import type { AdminRole } from "./AdminAccess.js";

export interface AdminUser {
  readonly id: string;
  readonly account: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly role: AdminRole;
  readonly status: "active" | "disabled";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastLoginAt?: number;
}

export interface AdminSession {
  readonly tokenHash: string;
  readonly adminUserId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
}

export interface AdminAuditLog {
  readonly id: string;
  readonly adminUserId: string;
  readonly action: "admin.login" | "admin.logout" | "player.ban" | "player.unban" | "save.rollback"
    | "announcement.create" | "announcement.update" | "announcement.delete" | "file.upload";
  readonly requestId: string;
  readonly ip: string;
  readonly createdAt: number;
  readonly targetPlayerId?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AdminErrorLog {
  readonly id: string;
  readonly occurredAt: number;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly errorName: string;
}
