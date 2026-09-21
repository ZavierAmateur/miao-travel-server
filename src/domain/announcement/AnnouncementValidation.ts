import sanitizeHtml from "sanitize-html";
import { PlatformKind } from "../../config/AppConfig.js";
import type { AnnouncementImage, PutAnnouncementInput } from "./Announcement.js";
import { AnnouncementStatus } from "./Announcement.js";
import { AnnouncementError } from "./AnnouncementErrors.js";

const MAX_CONTENT_LENGTH = 30_000;
const MAX_IMAGES = 9;

export function validateAnnouncementInput(input: PutAnnouncementInput): PutAnnouncementInput {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 100) invalid("公告标题长度必须为 1-100 个字符");

  const contentHtml = sanitizeAnnouncementHtml(input.contentHtml);
  const plainText = sanitizeHtml(contentHtml, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!plainText) invalid("公告正文不能为空");
  if (contentHtml.length > MAX_CONTENT_LENGTH) invalid(`公告正文不能超过 ${MAX_CONTENT_LENGTH} 个字符`);

  if (!Array.isArray(input.images) || input.images.length > MAX_IMAGES) {
    invalid(`公告图片最多 ${MAX_IMAGES} 张`);
  }
  const images = input.images.map(validateImage);

  if (!Object.values(AnnouncementStatus).includes(input.status)) invalid("公告状态无效");
  const rawPlatforms: unknown = input.platforms;
  if (!Array.isArray(rawPlatforms) || rawPlatforms.length === 0) invalid("公告至少选择一个平台");
  const allowedPlatforms: readonly string[] = Object.values(PlatformKind);
  if ((rawPlatforms as unknown[]).some((platform) => typeof platform !== "string" || !allowedPlatforms.includes(platform))) {
    invalid("公告平台无效");
  }
  const platforms = [...new Set(rawPlatforms as PlatformKind[])];

  if (!Number.isInteger(input.sortOrder) || input.sortOrder < -100_000 || input.sortOrder > 100_000) {
    invalid("公告排序值必须是 -100000 至 100000 的整数");
  }
  if (typeof input.autoPopup !== "boolean") invalid("公告自动弹出设置无效");
  if (!isTimestamp(input.startsAt) || !isTimestamp(input.endsAt)) invalid("公告时间必须是非负整数时间戳");
  if (input.endsAt > 0 && input.startsAt > 0 && input.endsAt <= input.startsAt) {
    invalid("公告结束时间必须晚于开始时间");
  }

  return {
    title,
    contentHtml,
    images,
    status: input.status,
    platforms,
    sortOrder: input.sortOrder,
    autoPopup: input.autoPopup,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  };
}

export function sanitizeAnnouncementHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "span"],
    allowedAttributes: { p: ["style"], span: ["style"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
        "font-size": [/^\d{1,2}(?:px|em|rem|%)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
      },
    },
    disallowedTagsMode: "discard",
  }).trim();
}

export function announcementSummary(contentHtml: string): string {
  const text = sanitizeHtml(contentHtml, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function validateImage(image: AnnouncementImage, index: number): AnnouncementImage {
  const fileId = image.fileId?.trim();
  const objectKey = image.objectKey?.trim();
  const url = image.url?.trim();
  const alt = image.alt?.trim() ?? "";
  if (!fileId || fileId.length > 128) invalid(`第 ${index + 1} 张图片 fileId 无效`);
  if (!objectKey || objectKey.length > 512 || objectKey.startsWith("/")) invalid(`第 ${index + 1} 张图片 objectKey 无效`);
  if (!url || url.length > 2_048 || !isHttpsUrl(url)) invalid(`第 ${index + 1} 张图片 URL 必须是 HTTPS 地址`);
  if (alt.length > 200) invalid(`第 ${index + 1} 张图片说明不能超过 200 个字符`);
  return { fileId, objectKey, url, alt };
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalid(message: string): never {
  throw new AnnouncementError("INVALID_ANNOUNCEMENT", message, 400);
}
