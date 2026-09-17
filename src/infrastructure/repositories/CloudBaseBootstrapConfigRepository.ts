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

  async save(config: BootstrapConfigRecord): Promise<void> {
    await this.collection.doc(BOOTSTRAP_CONFIG_DOCUMENT_ID).set(validateBootstrapConfigRecord(config));
  }
}
