import {
  type BootstrapConfigRecord,
  validateBootstrapConfigRecord,
} from "../../domain/config/BootstrapConfig.js";
import type { BootstrapConfigRepository } from "../../domain/config/BootstrapConfigRepository.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";

const BOOTSTRAP_CONFIG_DOCUMENT_ID = "bootstrap";

export class CloudBaseBootstrapConfigRepository implements BootstrapConfigRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

  async find(): Promise<BootstrapConfigRecord | undefined> {
    try {
      const result = await this.collection.doc(BOOTSTRAP_CONFIG_DOCUMENT_ID).get();
      const document = result.data[0] as BootstrapConfigRecord | undefined;
      return document ? validateBootstrapConfigRecord(document) : undefined;
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }

  async compareAndSet(expectedRevision: number, config: BootstrapConfigRecord): Promise<boolean> {
    const validated = { ...validateBootstrapConfigRecord(config) } as BootstrapConfigRecord & { _id?: string };
    delete validated._id;
    const result = await this.collection.where({ _id: BOOTSTRAP_CONFIG_DOCUMENT_ID, revision: expectedRevision }).update(validated);
    if (result.updated === 1) return true;
    if (expectedRevision !== 0) return false;
    // 固定ID插入，避免首次初始化时两个管理员相互覆盖。
    try {
      await this.collection.add({ _id: BOOTSTRAP_CONFIG_DOCUMENT_ID, ...validated });
      return true;
    } catch (error) {
      if (await this.find()) return false;
      throw error;
    }
  }

  async save(config: BootstrapConfigRecord): Promise<void> {
    await this.collection.doc(BOOTSTRAP_CONFIG_DOCUMENT_ID).set(validateBootstrapConfigRecord(config));
  }
}
