import type { BootstrapConfigRecord } from "./BootstrapConfig.js";

export interface BootstrapConfigRepository {
  find(): Promise<BootstrapConfigRecord | undefined>;
  save(config: BootstrapConfigRecord): Promise<void>;
}
