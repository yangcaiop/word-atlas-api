import cors from "cors";
import { accountRouter } from "./auth/routes.js";
import { createPool, AccountRepository } from "./db/mysql.js";
import express from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import type { Config } from "./config/env.js";
import { AppError } from "./lib/app-error.js";
import { createLogger } from "./lib/logger.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { apiRouter } from "./routes/index.js";

export function createApp(
  config: Config,
  logger: Logger = createLogger(config),
  repository = new AccountRepository(createPool(config.MYSQL_URL)),
) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(
            new AppError(403, "ORIGIN_NOT_ALLOWED", "请求来源不在允许列表中"),
          );
        }
      },
      credentials: true,
      exposedHeaders: ["X-Request-Id"],
    }),
  );
  app.use(express.json({ limit: `${config.JSON_BODY_LIMIT_MB}mb` }));
  app.use("/api", apiRouter);
  app.use("/api", accountRouter(config, repository));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
