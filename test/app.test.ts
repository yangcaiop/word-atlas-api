import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";

interface HealthResponse {
  success: boolean;
  data: { status: string; service: string };
}

interface ErrorResponse {
  success: boolean;
  error: { code: string; message: string };
  requestId: string;
}

const app = createApp(
  parseEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", JSON_BODY_LIMIT_MB: "1" }),
);
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health endpoint responds without a database and prevents caching", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = (await response.json()) as HealthResponse;
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.service, "word-atlas-api");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.ok(response.headers.get("x-request-id"));
});

test("unknown routes return the JSON error contract with a matching request ID", async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  const body = (await response.json()) as ErrorResponse;
  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
});

test("only configured browser origins receive access", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "http://localhost:5188" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "http://localhost:5188",
  );
  await allowed.arrayBuffer();

  const blocked = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://other.example" },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  assert.equal(
    ((await blocked.json()) as ErrorResponse).error.code,
    "ORIGIN_NOT_ALLOWED",
  );

  const preflight = await fetch(`${baseUrl}/api/health`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5188",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:5188",
  );
});

test("malformed JSON returns a safe 400 without reflecting its contents", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"password":"do-not-reflect",',
  });
  const text = await response.text();
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(text).error.code, "INVALID_JSON");
  assert.equal(text.includes("do-not-reflect"), false);
});

test("oversized JSON returns a structured 413", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "x".repeat(1024 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal(
    ((await response.json()) as ErrorResponse).error.code,
    "PAYLOAD_TOO_LARGE",
  );
});

test("invalid environment values fail before the server starts", () => {
  assert.throws(() => parseEnv({ PORT: "not-a-port" }), /PORT/);
  assert.throws(() => parseEnv({ PORT: "0" }), /PORT/);
  assert.throws(() => parseEnv({ CORS_ORIGINS: "*" }), /CORS_ORIGINS/);
  assert.throws(
    () => parseEnv({ CORS_ORIGINS: "https://example.com/page" }),
    /CORS_ORIGINS/,
  );
  assert.throws(
    () => parseEnv({ JSON_BODY_LIMIT_MB: "-1" }),
    /JSON_BODY_LIMIT_MB/,
  );
});
