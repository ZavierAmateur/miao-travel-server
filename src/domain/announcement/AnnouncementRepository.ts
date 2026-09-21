import type { Announcement } from "./Announcement.js";

export interface AnnouncementRepository {
  findById(id: string): Promise<Announcement | undefined>;
  listAll(): Promise<readonly Announcement[]>;
  save(announcement: Announcement): Promise<void>;
  delete(id: string): Promise<void>;
}
