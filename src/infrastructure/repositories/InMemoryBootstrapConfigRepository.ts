import type { BootstrapConfigRecord } from "../../domain/config/BootstrapConfig.js";
import type { BootstrapConfigRepository } from "../../domain/config/BootstrapConfigRepository.js";

export class InMemoryBootstrapConfigRepository implements BootstrapConfigRepository {
  constructor(private config?: BootstrapConfigRecord) {}

  find(): Promise<BootstrapConfigRecord | undefined> {
    return Promise.resolve(this.config);
  }

  compareAndSet(expectedRevision: number, config: BootstrapConfigRecord): Promise<boolean> {
    if ((this.config?.revision ?? 0) !== expectedRevision) return Promise.resolve(false);
    this.config = config;
    return Promise.resolve(true);
  }

  save(config: BootstrapConfigRecord): Promise<void> {
    this.config = config;
    return Promise.resolve();
  }
}
