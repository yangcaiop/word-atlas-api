import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { pino } from "pino";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestLogger } from "../src/middleware/request-logger.js";

test("Express async errors return a generic 500 without exposing internal details", async (context) => {
  const logger = pino({ level: "silent" });
  const app = express();
  app.use(requestLogger(logger));
  app.get("/fail", async () => {
    throw new Error("private-server-detail");
  });
  app.use(errorHandler(logger));

  const server = app.listen(0, "127.0.0.1");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  await once(server, "listening");

  const response = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/fail`,
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false,
    error: { code: "INTERNAL_SERVER_ERROR", message: "服务器内部错误" },
    requestId: response.headers.get("x-request-id"),
  });
});
