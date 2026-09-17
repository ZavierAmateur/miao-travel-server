export interface BootstrapConfigRecord {
  readonly revision: number;
  readonly maintenanceEnabled: boolean;
  readonly maintenanceMessage: string;
  readonly minimumClientVersion: string;
  readonly cloudSaveEnabled: boolean;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export interface BootstrapConfigData {
  readonly configRevision: number;
  readonly maintenance: {
    readonly enabled: boolean;
    readonly message: string;
  };
  readonly minimumClientVersion: string;
  readonly features: {
    readonly cloudSaveEnabled: boolean;
  };
  readonly cacheTtlSeconds: number;
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfigRecord = Object.freeze({
  revision: 0,
  maintenanceEnabled: false,
  maintenanceMessage: "",
  minimumClientVersion: "",
  cloudSaveEnabled: true,
  updatedAt: 0,
  updatedBy: "system-default",
});

export function validateBootstrapConfigRecord(value: BootstrapConfigRecord): BootstrapConfigRecord {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("远程配置 revision 必须是非负安全整数");
  }
  if (typeof value.maintenanceEnabled !== "boolean") {
    throw new Error("maintenanceEnabled 必须是布尔值");
  }
  if (typeof value.maintenanceMessage !== "string" || value.maintenanceMessage.length > 500) {
    throw new Error("maintenanceMessage 必须是不超过 500 字符的字符串");
  }
  if (typeof value.minimumClientVersion !== "string" || value.minimumClientVersion.length > 64) {
    throw new Error("minimumClientVersion 必须是不超过 64 字符的字符串");
  }
  if (typeof value.cloudSaveEnabled !== "boolean") {
    throw new Error("cloudSaveEnabled 必须是布尔值");
  }
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw new Error("updatedAt 必须是非负安全整数");
  }
  if (typeof value.updatedBy !== "string" || value.updatedBy.length < 1 || value.updatedBy.length > 128) {
    throw new Error("updatedBy 必须是 1-128 字符的字符串");
  }
  return value;
}
