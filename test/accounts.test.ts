import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { AccountRepository, createPool, migrate } from "../src/db/mysql.js";
import { snapshotSchema, type Snapshot } from "../src/sync/schema.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

const snapshot: Snapshot = {
  progress: {
    version: 2,
    datasetId: "word-atlas-open",
    cards: {},
    bookmarks: ["abandon"],
    days: {},
    typing: [],
    mistakes: [],
    session: null,
  },
  settings: {
    accent: "uk",
    autoplay: true,
    dailyNew: 10,
    retention: 0.9,
    theme: "dark",
    sfx: true,
    spell: true,
    startLevel: 0,
    ambience: "stars",
    ambienceVolume: 0.45,
    splash: true,
  },
};
test("passwords use distinct salted hashes and verify without plaintext storage", async () => {
  const a = await hashPassword("test-password");
  const b = await hashPassword("test-password");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("test-password", a));
  assert.ok(!(await verifyPassword("wrong-password", a)));
});
test("snapshot validation rejects wrong versions, sessions, invalid nested data and private datasets", () => {
  assert.ok(snapshotSchema.safeParse(snapshot).success);
  for (const progress of [
    { ...snapshot.progress, version: 1 },
    { ...snapshot.progress, datasetId: "private" },
    { ...snapshot.progress, session: { id: "x" } },
    {
      ...snapshot.progress,
      typing: [{ at: 1, mode: "hack", items: 1, wpm: 0, accuracy: 90 }],
    },
    { ...snapshot.progress, cards: { abandon: { due: -1 } } },
  ])
    assert.ok(!snapshotSchema.safeParse({ ...snapshot, progress }).success);
});
test(
  "MySQL account lifecycle, isolation, registration rollback and optimistic concurrency",
  { skip: !process.env.MYSQL_TEST_URL },
  async () => {
    const pool = createPool(process.env.MYSQL_TEST_URL!);
    await migrate(pool);
    const repository = new AccountRepository(pool);
    const server = createApp(
      parseEnv({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        AUTH_RATE_LIMIT: "100",
      }),
      undefined,
      repository,
    ).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const suffix = Date.now().toString(36);
    const created: string[] = [];
    const call = async (
      path: string,
      method = "GET",
      body?: unknown,
      cookie = "",
      userId = "",
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "content-type": "application/json",
          cookie,
          "X-Atlas-User": userId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        response,
        body: (await response.json()) as {
          data: {
            user: { id: string; username: string };
            snapshot: Snapshot;
            revision: number;
            updatedAt: string;
          };
          error: { code: string };
        },
        cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie,
      };
    };
    try {
      const a = await call("/auth/register", "POST", {
        username: `alice_${suffix}`,
        password: "test-password",
        snapshot,
      });
      assert.equal(a.response.status, 201);
      created.push(a.body.data.user.id);
      const uid = a.body.data.user.id as string;
      assert.ok(a.response.headers.get("set-cookie")?.includes("HttpOnly"));
      assert.equal(a.body.data.revision, 1);
      assert.ok(
        Math.abs(Date.parse(a.body.data.updatedAt) - Date.now()) < 5000,
      );
      assert.deepEqual(a.body.data.snapshot, snapshot);
      assert.equal(
        (
          await call("/auth/register", "POST", {
            username: `ALICE_${suffix}`,
            password: "test-password",
            snapshot,
          })
        ).response.status,
        409,
      );
      assert.equal(
        (
          await call("/auth/login", "POST", {
            username: `alice_${suffix}`,
            password: "bad-password",
          })
        ).response.status,
        401,
      );
      const login = await call("/auth/login", "POST", {
        username: `alice_${suffix}`,
        password: "test-password",
      });
      assert.deepEqual(login.body.data.snapshot, snapshot);
      assert.equal(
        (await call("/auth/me", "GET", undefined, login.cookie)).body.data.user
          .id,
        uid,
      );
      assert.equal((await call("/sync/word-atlas-open")).response.status, 401);
      const changed = {
        ...snapshot,
        progress: { ...snapshot.progress, bookmarks: ["abandon", "ability"] },
      };
      const upload = await call(
        "/sync/word-atlas-open",
        "PUT",
        { baseRevision: 1, snapshot: changed },
        login.cookie,
        uid,
      );
      assert.equal(upload.response.status, 200);
      assert.equal(upload.body.data.revision, 2);
      assert.equal(
        (
          await call(
            "/sync/word-atlas-open",
            "PUT",
            { baseRevision: 1, snapshot },
            login.cookie,
            uid,
          )
        ).body.error.code,
        "DATA_CONFLICT",
      );
      const both = await Promise.all(
        [3, 4].map(() =>
          call(
            "/sync/word-atlas-open",
            "PUT",
            { baseRevision: 2, snapshot: changed },
            login.cookie,
            uid,
          ),
        ),
      );
      assert.deepEqual(both.map((r) => r.response.status).sort(), [200, 409]);
      const b = await call("/auth/register", "POST", {
        username: `bob_${suffix}`,
        password: "test-password",
        snapshot,
      });
      created.push(b.body.data.user.id);
      assert.equal(
        (
          await call(
            "/sync/word-atlas-open",
            "PUT",
            { baseRevision: 1, snapshot: changed },
            b.cookie,
            uid,
          )
        ).body.error.code,
        "ACCOUNT_CHANGED",
      );
      assert.deepEqual(
        (
          await call(
            "/sync/word-atlas-open",
            "GET",
            undefined,
            b.cookie,
            b.body.data.user.id,
          )
        ).body.data.snapshot,
        snapshot,
      );
      assert.equal(
        (
          await call(
            "/sync/word-atlas-open",
            "PUT",
            {
              baseRevision: 3,
              snapshot: {
                ...snapshot,
                progress: { ...snapshot.progress, version: 1 },
              },
            },
            login.cookie,
            uid,
          )
        ).response.status,
        400,
      );
      assert.equal(
        (await call("/auth/logout", "POST", {}, login.cookie, uid)).response
          .status,
        200,
      );
      assert.equal(
        (await call("/auth/me", "GET", undefined, login.cookie)).response
          .status,
        401,
      );
      assert.deepEqual(
        (await call("/sync/word-atlas-open", "GET", undefined, a.cookie, uid))
          .body.data.snapshot,
        changed,
      );
      // A failed initial snapshot write rolls back the user and session as well.
      await assert.rejects(
        repository.create(
          { id: randomUUID(), username: `rollback_${suffix}` },
          "hash",
          snapshot,
          "f".repeat(65),
          new Date(Date.now() + 100000),
        ),
      );
      assert.equal(
        await repository.userByName(`rollback_${suffix}`),
        undefined,
      );
    } finally {
      for (const userId of created)
        await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
