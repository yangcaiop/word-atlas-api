import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { AppError } from "../lib/app-error.js";

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "接口不存在"));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    let failure = new AppError(500, "INTERNAL_SERVER_ERROR", "服务器内部错误");
    if (error instanceof AppError) {
      failure = error;
    } else if (error instanceof Error && "type" in error) {
      switch (error.type) {
        case "entity.parse.failed":
          failure = new AppError(400, "INVALID_JSON", "请求体不是有效的 JSON");
          break;
        case "entity.too.large":
          failure = new AppError(
            413,
            "PAYLOAD_TOO_LARGE",
            "请求体超过大小限制",
          );
          break;
        case "charset.unsupported":
        case "encoding.unsupported":
          failure = new AppError(
            415,
            "UNSUPPORTED_ENCODING",
            "不支持此请求编码",
          );
          break;
        case "request.aborted":
        case "request.size.invalid":
          failure = new AppError(400, "INVALID_REQUEST", "请求未完整接收");
          break;
      }
    } else if (error instanceof URIError) {
      failure = new AppError(400, "INVALID_URL", "请求地址格式错误");
    }

    if (failure.statusCode >= 500) {
      logger.error(
        { err: error, requestId: res.locals.requestId },
        "Unhandled request error",
      );
    }
    res.status(failure.statusCode).json({
      success: false,
      error: { code: failure.code, message: failure.message },
      requestId: res.locals.requestId,
    });
  };
}
