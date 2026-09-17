import { createHash } from "node:crypto";
import {
  DEFAULT_BOOTSTRAP_CONFIG,
  type BootstrapConfigData,
  type BootstrapConfigRecord,
  validateBootstrapConfigRecord,
} from "./BootstrapConfig.js";
import type { BootstrapConfigRepository } from "./BootstrapConfigRepository.js";

export interface BootstrapConfigResult {
  readonly data: BootstrapConfigData;
  readonly etag: string;
}

export class BootstrapConfigService {
  constructor(
    private readonly repository: BootstrapConfigRepository,
    private readonly cacheTtlSeconds = 300,
  ) {}

  async get(): Promise<BootstrapConfigResult> {
    const stored = await this.repository.find();
    const config = validateBootstrapConfigRecord(stored ?? DEFAULT_BOOTSTRAP_CONFIG);
    const data = this.toData(config);
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    return { data, etag };
  }

  private toData(config: BootstrapConfigRecord): BootstrapConfigData {
    return {
      configRevision: config.revision,
      maintenance: {
        enabled: config.maintenanceEnabled,
        message: config.maintenanceMessage,
      },
      minimumClientVersion: config.minimumClientVersion,
      features: {
        cloudSaveEnabled: config.cloudSaveEnabled,
      },
      cacheTtlSeconds: this.cacheTtlSeconds,
    };
  }
}
