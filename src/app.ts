import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/AppConfig.js";
import { success } from "./contracts/ApiResponse.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
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
    }, now());
  });

  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      code: "ROUTE_NOT_FOUND",
      msg: "接口不存在",
      timestamp: now(),
      requestId: request.id,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
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
