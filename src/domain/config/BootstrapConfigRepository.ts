import type { BootstrapConfigRecord } from "./BootstrapConfig.js";

export interface BootstrapConfigRepository {
  find(): Promise<BootstrapConfigRecord | undefined>;
  compareAndSet(expectedRevision: number, config: BootstrapConfigRecord): Promise<boolean>;
  save(config: BootstrapConfigRecord): Promise<void>;
}
