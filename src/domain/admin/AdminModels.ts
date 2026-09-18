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
  readonly action: "admin.login" | "admin.logout";
  readonly requestId: string;
  readonly ip: string;
  readonly createdAt: number;
}
