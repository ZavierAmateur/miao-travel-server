export const AdminRole = Object.freeze({
  Admin: "admin",
  Operator: "operator",
} as const);

export type AdminRole = typeof AdminRole[keyof typeof AdminRole];

export const AdminPermission = Object.freeze({
  MetricsRead: "metrics:read",
  PlayerRead: "player:read",
  PlayerBan: "player:ban",
  SaveRead: "save:read",
  SaveRollback: "save:rollback",
  ErrorRead: "error:read",
  ConfigRead: "config:read",
  ConfigWrite: "config:write",
  ConfigPublish: "config:publish",
  AuditRead: "audit:read",
  AdminManage: "admin:manage",
} as const);

export type AdminPermission = typeof AdminPermission[keyof typeof AdminPermission];

const operatorPermissions: readonly AdminPermission[] = [
  AdminPermission.MetricsRead,
  AdminPermission.PlayerRead,
  AdminPermission.PlayerBan,
  AdminPermission.SaveRead,
  AdminPermission.ErrorRead,
  AdminPermission.ConfigRead,
  AdminPermission.ConfigWrite,
];

const adminPermissions: readonly AdminPermission[] = Object.values(AdminPermission);

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return role === AdminRole.Admin ? adminPermissions : operatorPermissions;
}
