export interface CosStorageConfig {
  readonly enabled: boolean;
  readonly secretId: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly region: string;
  readonly publicBaseUrl: string;
}

export class CosStorageConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`COS 配置无效：${issues.join("；")}`);
    this.name = "CosStorageConfigError";
  }
}

export function loadCosStorageConfig(env: NodeJS.ProcessEnv = process.env): CosStorageConfig {
  const secretId = env.COS_SECRET_ID?.trim() ?? "";
  const secretKey = env.COS_SECRET_KEY?.trim() ?? "";
  const bucket = env.COS_BUCKET?.trim() ?? "";
  const region = env.COS_REGION?.trim() ?? "";
  const rawPublicBaseUrl = env.COS_PUBLIC_BASE_URL?.trim() ?? "";
  const enabled = Boolean(secretId || secretKey || bucket || region || rawPublicBaseUrl);
  if (!enabled) return { enabled: false, secretId: "", secretKey: "", bucket: "", region: "", publicBaseUrl: "" };

  const issues: string[] = [];
  if (!secretId) issues.push("必须配置 COS_SECRET_ID");
  if (!secretKey) issues.push("必须配置 COS_SECRET_KEY");
  if (!bucket) issues.push("必须配置 COS_BUCKET");
  if (!region) issues.push("必须配置 COS_REGION");
  const publicBaseUrl = (rawPublicBaseUrl || `https://${bucket}.cos.${region}.myqcloud.com`).replace(/\/+$/, "");
  try {
    if (new URL(publicBaseUrl).protocol !== "https:") issues.push("COS_PUBLIC_BASE_URL 必须是 HTTPS 地址");
  } catch {
    issues.push("COS_PUBLIC_BASE_URL 不是有效地址");
  }
  if (issues.length > 0) throw new CosStorageConfigError(issues);
  return { enabled: true, secretId, secretKey, bucket, region, publicBaseUrl };
}
