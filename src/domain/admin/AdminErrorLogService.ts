import { randomUUID } from "node:crypto";
import { AdminPermission } from "./AdminAccess.js";
import type { AdminAuthService } from "./AdminAuthService.js";
import { AdminErrorLogError } from "./AdminErrorLogErrors.js";
import type { AdminErrorLog } from "./AdminModels.js";
import type { AdminErrorLogRepository } from "./AdminRepositories.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_COUNT = 1_000;

export interface AdminErrorLogServiceOptions {
  readonly auth: AdminAuthService;
  readonly logs: AdminErrorLogRepository;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export interface RecordAdminErrorInput {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly errorName: string;
}

export class AdminErrorLogService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly options: AdminErrorLogServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async record(input: RecordAdminErrorInput): Promise<void> {
    await this.options.logs.append({
      id: this.createId(),
      occurredAt: this.now(),
      requestId: input.requestId.slice(0, 128),
      method: input.method.slice(0, 16),
      path: input.path.slice(0, 256),
      statusCode: input.statusCode,
      code: input.code.slice(0, 64),
      message: input.message.slice(0, 200),
      errorName: input.errorName.slice(0, 128),
    });
  }

  async list(token: string | undefined, query: {
    readonly requestId?: string;
    readonly code?: string;
    readonly from?: number;
    readonly to?: number;
    readonly cursor?: string;
    readonly limit?: number;
  }) {
    await this.requireRead(token);
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      throw new AdminErrorLogError("INVALID_ERROR_QUERY", "开始时间不能晚于结束时间", 400);
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    let scanOffset = decodeCursor(query.cursor);
    const scanEnd = scanOffset + MAX_SCAN_COUNT;
    const items: AdminErrorLog[] = [];

    while (scanOffset < scanEnd) {
      const batchSize = Math.min(SCAN_PAGE_SIZE, scanEnd - scanOffset);
      const batch = await this.options.logs.listRecent(scanOffset, batchSize);
      if (batch.length === 0) return { items, nextCursor: null };

      for (let index = 0; index < batch.length; index += 1) {
        const log = batch[index]!;
        const itemOffset = scanOffset + index;
        if (query.from !== undefined && log.occurredAt < query.from) {
          return { items, nextCursor: null };
        }
        if (matches(log, query)) {
          if (items.length === limit) {
            return { items, nextCursor: encodeCursor(itemOffset) };
          }
          items.push(log);
        }
      }

      scanOffset += batch.length;
      if (batch.length < batchSize) return { items, nextCursor: null };
    }

    return { items, nextCursor: encodeCursor(scanOffset) };
  }

  async get(token: string | undefined, id: string): Promise<AdminErrorLog> {
    await this.requireRead(token);
    const log = await this.options.logs.findById(id);
    if (!log) throw new AdminErrorLogError("ERROR_LOG_NOT_FOUND", "错误日志不存在", 404);
    return log;
  }

  private async requireRead(token?: string): Promise<void> {
    const { identity } = await this.options.auth.authenticate(token);
    if (!identity.permissions.includes(AdminPermission.ErrorRead)) {
      throw new AdminErrorLogError("ADMIN_PERMISSION_DENIED", "无权查看错误日志", 403);
    }
  }
}

function matches(log: AdminErrorLog, query: {
  readonly requestId?: string;
  readonly code?: string;
  readonly from?: number;
  readonly to?: number;
}): boolean {
  if (query.requestId && log.requestId !== query.requestId) return false;
  if (query.code && log.code !== query.code) return false;
  if (query.from !== undefined && log.occurredAt < query.from) return false;
  if (query.to !== undefined && log.occurredAt > query.to) return false;
  return true;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error("invalid");
    return Number(parsed.offset);
  } catch {
    throw new AdminErrorLogError("INVALID_CURSOR", "分页游标无效", 400);
  }
}
