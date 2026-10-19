import { posix } from "node:path";

const uploadDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function uploadOriginalName(filename: string): string {
  return Array.from(posix.basename(filename.replace(/\\/g, "/"))).slice(0, 255).join("");
}

export function createUploadObjectKey(filename: string, timestamp: number, fileId: string, format: "jpg" | "png" | "webp" = "webp"): string {
  const originalName = uploadOriginalName(filename).normalize("NFC");
  const extension = posix.extname(originalName);
  const stem = extension ? originalName.slice(0, -extension.length) : originalName;
  const safeStem = Array.from(stem
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, "_")
    .replace(/\s+/gu, "_")
    .replace(/^[._]+|[._]+$/g, ""))
    .slice(0, 80).join("") || "image";
  const parts = uploadDateFormatter.formatToParts(timestamp);
  const date = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("");
  return `admin/uploads/${safeStem}_${date}_${fileId}.${format}`;
}
