import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import type { AppConfig } from "./config/AppConfig.js";
import { success } from "./contracts/ApiResponse.js";
import type { PlatformLoginService } from "./domain/auth/PlatformLoginService.js";
import type { CloudSaveService } from "./domain/save/CloudSaveService.js";
import { CloudSaveConflictError, CloudSaveValidationError, SessionAuthenticationError } from "./domain/save/CloudSaveErrors.js";
import type { PutCloudSaveInput } from "./domain/save/CloudSaveValidation.js";
import { PlatformAuthError } from "./platform/PlatformAuthError.js";
import type { BootstrapConfigService } from "./domain/config/BootstrapConfigService.js";
import type { PlayerProfileService } from "./domain/profile/PlayerProfileService.js";
import type { PutPlayerProfileInput } from "./domain/profile/PlayerProfile.js";
import { PlayerProfileValidationError } from "./domain/profile/PlayerProfileErrors.js";
import type { AdminAuthService } from "./domain/admin/AdminAuthService.js";
import { AdminAuthError } from "./domain/admin/AdminAuthErrors.js";
import type { AdminAuthConfig } from "./config/AdminAuthConfig.js";
import type { AdminPlayerService } from "./domain/admin/AdminPlayerService.js";
import { AdminPlayerError } from "./domain/admin/AdminPlayerErrors.js";
import type { PlatformKind } from "./config/AppConfig.js";
import type { PlayerStatus } from "./domain/player/Player.js";
import type { AdminErrorLogService } from "./domain/admin/AdminErrorLogService.js";
import { AdminErrorLogError } from "./domain/admin/AdminErrorLogErrors.js";
import type { AnnouncementService } from "./domain/announcement/AnnouncementService.js";
import type { PutAnnouncementInput } from "./domain/announcement/Announcement.js";
import { AnnouncementError } from "./domain/announcement/AnnouncementErrors.js";
import type { AdminFileService } from "./domain/file/AdminFileService.js";
import { MAX_UPLOAD_BYTES } from "./domain/file/AdminFileService.js";
import { AdminFileError } from "./domain/file/AdminFileErrors.js";

const ADMIN_SESSION_COOKIE = "miao_admin_session";

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly platformLoginService?: PlatformLoginService;
  readonly cloudSaveService?: CloudSaveService;
  readonly bootstrapConfigService?: BootstrapConfigService;
  readonly playerProfileService?: PlayerProfileService;
  readonly adminAuthService?: AdminAuthService;
  readonly adminAuthConfig?: AdminAuthConfig;
  readonly adminPlayerService?: AdminPlayerService;
  readonly adminErrorLogService?: AdminErrorLogService;
  readonly announcementService?: AnnouncementService;
  readonly adminFileService?: AdminFileService;
  readonly now?: () => number;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const now = options.now ?? Date.now;
  const app = Fastify({
    logger: {
      level: options.config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.code",
          "req.body.anonymousCode",
          "req.body.token",
          "req.body.sessionKey",
          "req.body.save",
          "req.body.idempotencyKey",
          "req.body.nickName",
          "req.body.avatarUrl",
          "req.body.password",
          "req.headers.cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    genReqId: (request) => {
      const incoming = request.headers["x-request-id"];
      return typeof incoming === "string" && incoming.length <= 128
        ? incoming
        : crypto.randomUUID();
    },
  });
  void app.register(multipart, {
    limits: { files: 1, fields: 2, fileSize: MAX_UPLOAD_BYTES },
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] || "/";
    if (path !== "/v1/announcements" && !path.startsWith("/v1/announcements/")) return;
    const origin = request.headers.origin;
    if (!origin || !isAllowedGamePreviewOrigin(origin)) return;
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-methods", "GET,OPTIONS");
    reply.header("access-control-allow-headers", "Content-Type,X-Client-Version");
    reply.header("vary", "Origin");
    if (request.method === "OPTIONS") await reply.code(204).send();
  });

  const respondWithError = async (
    request: FastifyRequest,
    reply: FastifyReply,
    descriptor: { readonly statusCode: number; readonly code: string; readonly msg: string; readonly data?: unknown },
    errorName: string,
  ): Promise<void> => {
    const path = request.routeOptions.url || request.url.split("?", 1)[0] || "/";
    const shouldPersist = !path.startsWith("/admin/v1/errors")
      && !(path === "/admin/v1/auth/me" && descriptor.code === "ADMIN_AUTH_REQUIRED");
    if (options.adminErrorLogService && shouldPersist) {
      try {
        await options.adminErrorLogService.record({
          requestId: request.id,
          method: request.method,
          path,
          statusCode: descriptor.statusCode,
          code: descriptor.code,
          message: descriptor.msg,
          errorName,
        });
      } catch (logError) {
        request.log.error({
          errorName: logError instanceof Error ? logError.name : "UnknownError",
        }, "错误日志写入失败");
      }
    }
    await reply.code(descriptor.statusCode).send({
      code: descriptor.code,
      msg: descriptor.msg,
      timestamp: now(),
      requestId: request.id,
      ...(descriptor.data === undefined ? {} : { data: descriptor.data }),
    });
  };

  if (options.adminAuthService && options.adminAuthConfig) {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/admin/v1/")) return;
      const origin = request.headers.origin;
      const originAllowed = isAllowedAdminOrigin(
        origin,
        options.adminAuthConfig!.webOrigin,
        options.adminAuthConfig!.secureCookie,
      );
      if (origin && originAllowed) {
        reply.header("access-control-allow-origin", origin);
        reply.header("access-control-allow-credentials", "true");
        reply.header("vary", "Origin");
      }
      if (origin && !originAllowed && request.method !== "GET") {
        await reply.code(403).send({
          code: "ADMIN_ORIGIN_FORBIDDEN",
          msg: "管理请求来源不受信任",
          timestamp: now(),
          requestId: request.id,
        });
        return;
      }
      if (request.method === "OPTIONS") {
        reply.header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
        reply.header("access-control-allow-headers", "Content-Type,X-Request-Id");
        await reply.code(204).send();
      }
    });

    app.post<{ Body: { account: string; password: string } }>("/admin/v1/auth/login", {
      bodyLimit: 8 * 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["account", "password"],
          properties: {
            account: { type: "string", minLength: 3, maxLength: 64 },
            password: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.adminAuthService!.login(request.body.account, request.body.password, {
        requestId: request.id,
        ip: request.ip,
      });
      reply.header("set-cookie", serializeAdminCookie(result.token, result.expiresAt, now(), options.adminAuthConfig!.secureCookie));
      return success(request.id, { identity: result.identity, expiresAt: result.expiresAt }, now());
    });

    app.get("/admin/v1/auth/me", async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.adminAuthService!.authenticate(readAdminCookie(request.headers.cookie));
      return success(request.id, { identity: result.identity, expiresAt: result.session.expiresAt }, now());
    });

    app.post("/admin/v1/auth/logout", async (request, reply) => {
      reply.header("cache-control", "no-store");
      await options.adminAuthService!.logout(readAdminCookie(request.headers.cookie), {
        requestId: request.id,
        ip: request.ip,
      });
      reply.header("set-cookie", clearAdminCookie(options.adminAuthConfig!.secureCookie));
      return success(request.id, { loggedOut: true }, now());
    });

    if (options.adminPlayerService) {
      app.get<{
        Querystring: { playerId?: string; platform?: PlatformKind; status?: PlayerStatus; cursor?: string; limit?: number };
      }>("/admin/v1/players", {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              playerId: { type: "string", minLength: 1, maxLength: 128 },
              platform: { type: "string", enum: ["wechat", "bytedance"] },
              status: { type: "string", enum: ["active", "banned"] },
              cursor: { type: "string", minLength: 1, maxLength: 256 },
              limit: { type: "integer", minimum: 1, maximum: 50 },
            },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminPlayerService!.list(
          readAdminCookie(request.headers.cookie),
          request.query,
        );
        return success(request.id, result, now());
      });

      app.get<{ Params: { playerId: string } }>("/admin/v1/players/:playerId", {
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["playerId"],
            properties: { playerId: { type: "string", minLength: 1, maxLength: 128 } },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminPlayerService!.get(
          readAdminCookie(request.headers.cookie),
          request.params.playerId,
        );
        return success(request.id, result, now());
      });

      app.get<{ Params: { playerId: string } }>("/admin/v1/players/:playerId/save", {
        schema: { params: playerIdParamsSchema },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminPlayerService!.getSaveDiagnostics(
          readAdminCookie(request.headers.cookie),
          request.params.playerId,
        );
        return success(request.id, result, now());
      });

      app.post<{ Params: { playerId: string }; Body: { expectedRevision: number; reason: string } }>(
        "/admin/v1/players/:playerId/save-rollback",
        {
          bodyLimit: 8 * 1024,
          schema: {
            params: playerIdParamsSchema,
            body: {
              type: "object",
              additionalProperties: false,
              required: ["expectedRevision", "reason"],
              properties: {
                expectedRevision: { type: "integer", minimum: 1 },
                reason: { type: "string", minLength: 2, maxLength: 200 },
              },
            },
          },
        },
        async (request, reply) => {
          reply.header("cache-control", "no-store");
          const result = await options.adminPlayerService!.rollbackSave(
            readAdminCookie(request.headers.cookie), request.params.playerId, request.body,
            { requestId: request.id, ip: request.ip },
          );
          return success(request.id, result, now());
        },
      );

      app.post<{
        Params: { playerId: string };
        Body: { type: "temporary" | "permanent"; expiresAt?: number; reason: string; note?: string };
      }>("/admin/v1/players/:playerId/ban", {
        bodyLimit: 8 * 1024,
        schema: {
          params: playerIdParamsSchema,
          body: {
            type: "object",
            additionalProperties: false,
            required: ["type", "reason"],
            properties: {
              type: { type: "string", enum: ["temporary", "permanent"] },
              expiresAt: { type: "integer", minimum: 1 },
              reason: { type: "string", minLength: 2, maxLength: 200 },
              note: { type: "string", maxLength: 500 },
            },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminPlayerService!.ban(
          readAdminCookie(request.headers.cookie), request.params.playerId, request.body,
          { requestId: request.id, ip: request.ip },
        );
        return success(request.id, result, now());
      });

      app.post<{ Params: { playerId: string }; Body: { reason: string } }>("/admin/v1/players/:playerId/unban", {
        bodyLimit: 8 * 1024,
        schema: {
          params: playerIdParamsSchema,
          body: {
            type: "object",
            additionalProperties: false,
            required: ["reason"],
            properties: { reason: { type: "string", minLength: 2, maxLength: 200 } },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminPlayerService!.unban(
          readAdminCookie(request.headers.cookie), request.params.playerId, request.body,
          { requestId: request.id, ip: request.ip },
        );
        return success(request.id, result, now());
      });
    }

    if (options.adminErrorLogService) {
      app.get<{
        Querystring: { requestId?: string; code?: string; from?: number; to?: number; cursor?: string; limit?: number };
      }>("/admin/v1/errors", {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              requestId: { type: "string", minLength: 1, maxLength: 128 },
              code: { type: "string", minLength: 1, maxLength: 64 },
              from: { type: "integer", minimum: 0 },
              to: { type: "integer", minimum: 0 },
              cursor: { type: "string", minLength: 1, maxLength: 256 },
              limit: { type: "integer", minimum: 1, maximum: 50 },
            },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminErrorLogService!.list(
          readAdminCookie(request.headers.cookie),
          request.query,
        );
        return success(request.id, result, now());
      });

      app.get<{ Params: { errorId: string } }>("/admin/v1/errors/:errorId", {
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["errorId"],
            properties: { errorId: { type: "string", minLength: 1, maxLength: 128 } },
          },
        },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.adminErrorLogService!.get(
          readAdminCookie(request.headers.cookie),
          request.params.errorId,
        );
        return success(request.id, result, now());
      });
    }

    if (options.announcementService) {
      app.get<{
        Querystring: { page?: number; pageSize?: number; status?: "draft" | "published"; platform?: PlatformKind; keyword?: string };
      }>("/admin/v1/announcements", {
        schema: { querystring: adminAnnouncementListQuerySchema },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.announcementService!.listAdmin(
          readAdminCookie(request.headers.cookie), request.query,
        );
        return success(request.id, result, now());
      });

      app.get<{ Params: { announcementId: string } }>("/admin/v1/announcements/:announcementId", {
        schema: { params: announcementIdParamsSchema },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.announcementService!.getAdmin(
          readAdminCookie(request.headers.cookie), request.params.announcementId,
        );
        return success(request.id, result, now());
      });

      app.post<{ Body: PutAnnouncementInput }>("/admin/v1/announcements", {
        bodyLimit: 64 * 1024,
        schema: { body: announcementBodySchema },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.announcementService!.create(
          readAdminCookie(request.headers.cookie), request.body,
          { requestId: request.id, ip: request.ip },
        );
        return reply.code(201).send(success(request.id, result, now()));
      });

      app.put<{ Params: { announcementId: string }; Body: PutAnnouncementInput }>(
        "/admin/v1/announcements/:announcementId",
        { bodyLimit: 64 * 1024, schema: { params: announcementIdParamsSchema, body: announcementBodySchema } },
        async (request, reply) => {
          reply.header("cache-control", "no-store");
          const result = await options.announcementService!.update(
            readAdminCookie(request.headers.cookie), request.params.announcementId, request.body,
            { requestId: request.id, ip: request.ip },
          );
          return success(request.id, result, now());
        },
      );

      app.delete<{ Params: { announcementId: string } }>("/admin/v1/announcements/:announcementId", {
        schema: { params: announcementIdParamsSchema },
      }, async (request, reply) => {
        reply.header("cache-control", "no-store");
        const result = await options.announcementService!.delete(
          readAdminCookie(request.headers.cookie), request.params.announcementId,
          { requestId: request.id, ip: request.ip },
        );
        return success(request.id, result, now());
      });
    }

    if (options.adminFileService) {
      app.post("/admin/v1/files/upload", async (request, reply) => {
        reply.header("cache-control", "no-store");
        if (!request.isMultipart()) throw new AdminFileError("INVALID_UPLOAD", "请使用 multipart/form-data 上传文件", 400);
        let file;
        try {
          file = await request.file({ limits: { files: 1, fields: 2, fileSize: MAX_UPLOAD_BYTES } });
        } catch {
          throw new AdminFileError("FILE_TOO_LARGE", "上传文件不能超过 5MB", 413);
        }
        if (!file) throw new AdminFileError("FILE_REQUIRED", "请选择要上传的文件", 400);
        let body: Buffer;
        try {
          body = await file.toBuffer();
        } catch {
          throw new AdminFileError("FILE_TOO_LARGE", "上传文件不能超过 5MB", 413);
        }
        const result = await options.adminFileService!.upload(
          readAdminCookie(request.headers.cookie), { filename: file.filename, body },
          { requestId: request.id, ip: request.ip },
        );
        return success(request.id, result, now());
      });
    }
  }

  app.get("/health", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return success(request.id, {
      status: "ok",
      service: "miao-travel-server",
      version: "0.1.0",
      environment: options.config.environment,
      platform: options.config.platform,
      persistence: options.config.persistenceDriver,
    }, now());
  });

  if (options.bootstrapConfigService) {
    app.get("/v1/bootstrap-config", async (request, reply) => {
      const result = await options.bootstrapConfigService!.get();
      reply.header("cache-control", `public, max-age=${result.data.cacheTtlSeconds}`);
      reply.header("etag", result.etag);
      if (request.headers["if-none-match"] === result.etag) {
        return reply.code(304).send();
      }
      return success(request.id, result.data, now());
    });
  }

  if (options.announcementService) {
    app.get<{
      Querystring: { platform: PlatformKind; page?: number; pageSize?: number };
    }>("/v1/announcements", {
      schema: { querystring: publicAnnouncementListQuerySchema },
    }, async (request, reply) => {
      reply.header("cache-control", "public, max-age=60");
      const result = await options.announcementService!.listPublic(request.query);
      return success(request.id, result, now());
    });

    app.get<{
      Params: { announcementId: string };
      Querystring: { platform: PlatformKind };
    }>("/v1/announcements/:announcementId", {
      schema: { params: announcementIdParamsSchema, querystring: publicAnnouncementDetailQuerySchema },
    }, async (request, reply) => {
      reply.header("cache-control", "public, max-age=60");
      const result = await options.announcementService!.getPublic(request.params.announcementId, request.query.platform);
      return success(request.id, result, now());
    });
  }

  if (options.platformLoginService) {
    app.post<{
      Body: { code?: string; anonymousCode?: string; clientVersion: string };
    }>("/v1/auth/platform-login", {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["clientVersion"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 512 },
            anonymousCode: { type: "string", minLength: 1, maxLength: 512 },
            clientVersion: { type: "string", minLength: 1, maxLength: 64 },
          },
          anyOf: [{ required: ["code"] }, { required: ["anonymousCode"] }],
        },
      },
    }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.platformLoginService!.login(request.body);
      return success(request.id, result, now());
    });
  }

  if (options.cloudSaveService) {
    app.get("/v1/save", async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.cloudSaveService!.get(request.headers.authorization);
      return success(request.id, result, now());
    });

    app.put<{ Body: PutCloudSaveInput }>("/v1/save", {
      bodyLimit: 600 * 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["baseRevision", "clientVersion", "clientSavedAt", "save", "idempotencyKey"],
          properties: {
            baseRevision: { type: "integer", minimum: 0 },
            clientVersion: { type: "string", minLength: 1, maxLength: 64 },
            clientSavedAt: { type: "integer", minimum: 0 },
            save: { type: "object" },
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.cloudSaveService!.put(request.headers.authorization, request.body);
      return success(request.id, result, now());
    });
  }

  if (options.playerProfileService) {
    app.get("/v1/profile", async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.playerProfileService!.get(request.headers.authorization);
      return success(request.id, result, now());
    });

    app.put<{ Body: PutPlayerProfileInput }>("/v1/profile", {
      bodyLimit: 8 * 1024,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["nickName", "avatarUrl"],
          properties: {
            nickName: { type: "string", minLength: 1, maxLength: 64 },
            avatarUrl: { type: "string", maxLength: 2_048 },
          },
        },
      },
    }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      const result = await options.playerProfileService!.put(request.headers.authorization, request.body);
      return success(request.id, result, now());
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      code: "ROUTE_NOT_FOUND",
      msg: "接口不存在",
      timestamp: now(),
      requestId: request.id,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      await respondWithError(request, reply, {
        statusCode: 400, code: "INVALID_REQUEST", msg: "请求参数无效",
      }, error instanceof Error ? error.name : "ValidationError");
      return;
    }
    if (error instanceof PlatformAuthError) {
      request.log.warn({ platformErrorCode: error.platformErrorCode }, error.message);
      await respondWithError(request, reply, {
        statusCode: error.code === "PLATFORM_AUTH_UNAVAILABLE" ? 503 : 401,
        code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof SessionAuthenticationError) {
      await respondWithError(request, reply, {
        statusCode: error.code === "PLAYER_BANNED" ? 403 : 401,
        code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof CloudSaveValidationError) {
      await respondWithError(request, reply, {
        statusCode: error.code === "SAVE_TOO_LARGE" ? 413 : 400,
        code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof CloudSaveConflictError) {
      await respondWithError(request, reply, {
        statusCode: 409,
        code: "SAVE_CONFLICT",
        msg: error.message,
        ...(error.current ? { data: { current: error.current } } : {}),
      }, error.name);
      return;
    }
    if (error instanceof PlayerProfileValidationError) {
      await respondWithError(request, reply, {
        statusCode: 400, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof AdminAuthError) {
      await respondWithError(request, reply, {
        statusCode: error.statusCode, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof AdminPlayerError) {
      await respondWithError(request, reply, {
        statusCode: error.statusCode, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof AdminErrorLogError) {
      await respondWithError(request, reply, {
        statusCode: error.statusCode, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof AnnouncementError) {
      await respondWithError(request, reply, {
        statusCode: error.statusCode, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    if (error instanceof AdminFileError) {
      await respondWithError(request, reply, {
        statusCode: error.statusCode, code: error.code, msg: error.message,
      }, error.name);
      return;
    }
    request.log.error({
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "请求处理失败");
    await respondWithError(request, reply, {
      statusCode: 500, code: "INTERNAL_ERROR", msg: "服务器内部错误",
    }, error instanceof Error ? error.name : "UnknownError");
  });

  return app;
}

const playerIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId"],
  properties: { playerId: { type: "string", minLength: 1, maxLength: 128 } },
} as const;

const announcementIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["announcementId"],
  properties: { announcementId: { type: "string", minLength: 1, maxLength: 128 } },
} as const;

const publicAnnouncementListQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["platform"],
  properties: {
    platform: { type: "string", enum: ["wechat", "bytedance"] },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
  },
} as const;

const publicAnnouncementDetailQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["platform"],
  properties: { platform: { type: "string", enum: ["wechat", "bytedance"] } },
} as const;

const adminAnnouncementListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
    status: { type: "string", enum: ["draft", "published"] },
    platform: { type: "string", enum: ["wechat", "bytedance"] },
    keyword: { type: "string", maxLength: 100 },
  },
} as const;

const announcementBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "contentHtml", "images", "status", "platforms", "sortOrder", "autoPopup", "startsAt", "endsAt"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 100 },
    contentHtml: { type: "string", minLength: 1, maxLength: 30_000 },
    images: {
      type: "array",
      maxItems: 9,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fileId", "objectKey", "url", "alt"],
        properties: {
          fileId: { type: "string", minLength: 1, maxLength: 128 },
          objectKey: { type: "string", minLength: 1, maxLength: 512 },
          url: { type: "string", minLength: 1, maxLength: 2_048 },
          alt: { type: "string", maxLength: 200 },
        },
      },
    },
    status: { type: "string", enum: ["draft", "published"] },
    platforms: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["wechat", "bytedance"] } },
    sortOrder: { type: "integer", minimum: -100_000, maximum: 100_000 },
    autoPopup: { type: "boolean" },
    startsAt: { type: "integer", minimum: 0 },
    endsAt: { type: "integer", minimum: 0 },
  },
} as const;

function readAdminCookie(cookieHeader?: string): string | undefined {
  const entry = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(ADMIN_SESSION_COOKIE.length + 1)) : undefined;
}

function serializeAdminCookie(token: string, expiresAt: number, currentTime: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - currentTime) / 1_000));
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/admin/v1; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clearAdminCookie(secure: boolean): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/admin/v1; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function isAllowedAdminOrigin(origin: string | undefined, configuredOrigin: string, production: boolean): boolean {
  if (!origin) return true;
  if (origin === configuredOrigin) return true;
  if (production) return false;
  try {
    const actual = new URL(origin);
    const configured = new URL(configuredOrigin);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return actual.protocol === configured.protocol
      && actual.port === configured.port
      && loopbackHosts.has(actual.hostname)
      && loopbackHosts.has(configured.hostname);
  } catch {
    return false;
  }
}

function isAllowedGamePreviewOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname);
  } catch {
    return false;
  }
}
