import { pino } from "pino";
import type { Config } from "../config/env.js";

export function createLogger(config: Config) {
  return pino({
    name: "word-atlas-api",
    level: config.LOG_LEVEL,
    base: { service: "word-atlas-api", environment: config.NODE_ENV },
  });
}
