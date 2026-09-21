import { PlatformKind } from "../../config/AppConfig.js";
import { AnnouncementStatus, type Announcement, type AnnouncementImage } from "../../domain/announcement/Announcement.js";
import type { AnnouncementRepository } from "../../domain/announcement/AnnouncementRepository.js";
import type { CloudBaseCollectionReference } from "../persistence/CloudBaseDatabase.js";
import { isMissingDocument } from "../persistence/CloudBaseErrors.js";

const MAX_ANNOUNCEMENTS = 500;

export class CloudBaseAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly collection: CloudBaseCollectionReference) {}

  async findById(id: string): Promise<Announcement | undefined> {
    try {
      const result = await this.collection.doc(id).get();
      return toAnnouncement(result.data[0]);
    } catch (error) {
      if (isMissingDocument(error)) return undefined;
      throw error;
    }
  }

  async listAll(): Promise<readonly Announcement[]> {
    const result = await this.collection.where({})
      .orderBy("updatedAt", "desc")
      .limit(MAX_ANNOUNCEMENTS)
      .get();
    return result.data.flatMap((value) => {
      const announcement = toAnnouncement(value);
      return announcement ? [announcement] : [];
    });
  }

  async save(announcement: Announcement): Promise<void> {
    await this.collection.doc(announcement.id).set(announcement);
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).remove();
  }
}

function toAnnouncement(value: unknown): Announcement | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.contentHtml !== "string"
    || !isStatus(record.status) || !isPlatforms(record.platforms) || !Array.isArray(record.images)
    || typeof record.sortOrder !== "number" || typeof record.autoPopup !== "boolean"
    || typeof record.startsAt !== "number" || typeof record.endsAt !== "number"
    || typeof record.createdAt !== "number" || typeof record.updatedAt !== "number"
    || typeof record.createdBy !== "string" || typeof record.updatedBy !== "string") return undefined;
  const images = record.images.flatMap((image) => {
    const parsed = toImage(image);
    return parsed ? [parsed] : [];
  });
  if (images.length !== record.images.length) return undefined;
  return {
    id: record.id,
    title: record.title,
    contentHtml: record.contentHtml,
    images,
    status: record.status,
    platforms: record.platforms,
    sortOrder: record.sortOrder,
    autoPopup: record.autoPopup,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

function toImage(value: unknown): AnnouncementImage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const image = value as Record<string, unknown>;
  if (typeof image.fileId !== "string" || typeof image.objectKey !== "string"
    || typeof image.url !== "string" || typeof image.alt !== "string") return undefined;
  return { fileId: image.fileId, objectKey: image.objectKey, url: image.url, alt: image.alt };
}

function isStatus(value: unknown): value is Announcement["status"] {
  return Object.values(AnnouncementStatus).includes(value as Announcement["status"]);
}

function isPlatforms(value: unknown): value is readonly PlatformKind[] {
  return Array.isArray(value) && value.every((item) => Object.values(PlatformKind).includes(item as PlatformKind));
}
