import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import type { Logger } from "pino";

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    // Do not include request bodies, query strings, cookies or authorization headers.
    const log = (event: "finished" | "aborted") => {
      const statusCode = event === "aborted" ? 499 : res.statusCode;
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl.split("?")[0],
          statusCode,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        },
        "HTTP request",
      );
    };
    res.once("finish", () => log("finished"));
    res.once("close", () => {
      if (!res.writableFinished) log("aborted");
    });
    next();
  };
}
