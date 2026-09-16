import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/AppConfig.js";
import { success } from "./contracts/ApiResponse.js";
import type { PlatformLoginService } from "./domain/auth/PlatformLoginService.js";
import type { CloudSaveService } from "./domain/save/CloudSaveService.js";
import { CloudSaveConflictError, CloudSaveValidationError, SessionAuthenticationError } from "./domain/save/CloudSaveErrors.js";
import type { PutCloudSaveInput } from "./domain/save/CloudSaveValidation.js";
import { PlatformAuthError } from "./platform/PlatformAuthError.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly platformLoginService?: PlatformLoginService;
  readonly cloudSaveService?: CloudSaveService;
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
      await reply.code(400).send({
        code: "INVALID_REQUEST",
        msg: "请求参数无效",
        timestamp: now(),
        requestId: request.id,
      });
      return;
    }
    if (error instanceof PlatformAuthError) {
      request.log.warn({ platformErrorCode: error.platformErrorCode }, error.message);
      await reply.code(error.code === "PLATFORM_AUTH_UNAVAILABLE" ? 503 : 401).send({
        code: error.code,
        msg: error.message,
        timestamp: now(),
        requestId: request.id,
      });
      return;
    }
    if (error instanceof SessionAuthenticationError) {
      await reply.code(401).send({
        code: error.code,
        msg: error.message,
        timestamp: now(),
        requestId: request.id,
      });
      return;
    }
    if (error instanceof CloudSaveValidationError) {
      await reply.code(error.code === "SAVE_TOO_LARGE" ? 413 : 400).send({
        code: error.code,
        msg: error.message,
        timestamp: now(),
        requestId: request.id,
      });
      return;
    }
    if (error instanceof CloudSaveConflictError) {
      await reply.code(409).send({
        code: "SAVE_CONFLICT",
        msg: error.message,
        timestamp: now(),
        requestId: request.id,
        ...(error.current ? { data: { current: error.current } } : {}),
      });
      return;
    }
    request.log.error({ err: error }, "请求处理失败");
    await reply.code(500).send({
      code: "INTERNAL_ERROR",
      msg: "服务器内部错误",
      timestamp: now(),
      requestId: request.id,
    });
  });

  return app;
}
