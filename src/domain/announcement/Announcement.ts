import type { PlatformKind } from "../../config/AppConfig.js";

export const AnnouncementStatus = Object.freeze({
  Draft: "draft",
  Published: "published",
} as const);

export type AnnouncementStatus = typeof AnnouncementStatus[keyof typeof AnnouncementStatus];

export interface AnnouncementImage {
  readonly fileId: string;
  readonly objectKey: string;
  readonly url: string;
  readonly alt: string;
}

export interface Announcement {
  readonly id: string;
  readonly title: string;
  readonly contentHtml: string;
  readonly images: readonly AnnouncementImage[];
  readonly status: AnnouncementStatus;
  readonly platforms: readonly PlatformKind[];
  readonly sortOrder: number;
  readonly autoPopup: boolean;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface PutAnnouncementInput {
  readonly title: string;
  readonly contentHtml: string;
  readonly images: readonly AnnouncementImage[];
  readonly status: AnnouncementStatus;
  readonly platforms: readonly PlatformKind[];
  readonly sortOrder: number;
  readonly autoPopup: boolean;
  readonly startsAt: number;
  readonly endsAt: number;
}
