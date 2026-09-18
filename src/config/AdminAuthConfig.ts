export interface AdminAuthConfig {
  readonly enabled: boolean;
  readonly bootstrapAccount: string;
  readonly bootstrapPassword: string;
  readonly bootstrapDisplayName: string;
  readonly webOrigin: string;
  readonly secureCookie: boolean;
}

export function loadAdminAuthConfig(env: NodeJS.ProcessEnv = process.env): AdminAuthConfig {
  const bootstrapAccount = env.ADMIN_BOOTSTRAP_ACCOUNT?.trim() ?? "";
  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD ?? "";
  const enabled = Boolean(bootstrapAccount || bootstrapPassword);
  if (enabled && (!bootstrapAccount || !bootstrapPassword)) {
    throw new Error("ADMIN_BOOTSTRAP_ACCOUNT 与 ADMIN_BOOTSTRAP_PASSWORD 必须同时配置");
  }
  if (enabled && bootstrapPassword.length < 12) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD 至少需要 12 个字符");
  }
  return {
    enabled,
    bootstrapAccount,
    bootstrapPassword,
    bootstrapDisplayName: env.ADMIN_BOOTSTRAP_DISPLAY_NAME?.trim() || "超级管理员",
    webOrigin: (env.ADMIN_WEB_ORIGIN?.trim() || "http://127.0.0.1:5173").replace(/\/$/, ""),
    secureCookie: env.NODE_ENV === "production",
  };
}
