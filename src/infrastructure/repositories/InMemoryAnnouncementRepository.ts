import type { Announcement } from "../../domain/announcement/Announcement.js";
import type { AnnouncementRepository } from "../../domain/announcement/AnnouncementRepository.js";

export class InMemoryAnnouncementRepository implements AnnouncementRepository {
  private readonly records = new Map<string, Announcement>();

  findById(id: string): Promise<Announcement | undefined> {
    return Promise.resolve(this.records.get(id));
  }

  listAll(): Promise<readonly Announcement[]> {
    return Promise.resolve([...this.records.values()]);
  }

  save(announcement: Announcement): Promise<void> {
    this.records.set(announcement.id, announcement);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }
}
