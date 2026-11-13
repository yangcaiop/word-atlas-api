import { createPool, AccountRepository } from "./db/mysql.js";
import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";

loadEnv({ quiet: true });
const config = parseEnv(process.env);
const logger = createLogger(config);
const pool = createPool(config.MYSQL_URL);
const app = createApp(config, logger, new AccountRepository(pool));

const server = createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.on("error", (error) => {
  logger.fatal({ err: error }, "API server failed to start");
  process.exit(1);
});

server.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT }, "API server listening");
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "API server shutting down");
  const timeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  timeout.unref();

  server.close(async (error) => {
    await pool.end();
    clearTimeout(timeout);
    if (error) {
      logger.error({ err: error }, "API server shutdown failed");
      process.exitCode = 1;
    } else {
      logger.info("API server stopped");
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
