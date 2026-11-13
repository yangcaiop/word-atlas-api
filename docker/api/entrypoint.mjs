import { readFile } from "node:fs/promises";
import { parseEnv } from "../dist/config/env.js";
import { createPool, migrate } from "../dist/db/mysql.js";

async function start() {
  const mode = process.argv[2] || "serve";
  if (!["serve", "migrate"].includes(mode)) {
    throw new Error("Supported commands: serve, migrate");
  }
  if (!process.env.MYSQL_URL) {
    const password = (
      await readFile(
        process.env.DB_PASSWORD_FILE || "/run/secrets/mysql_password",
        "utf8",
      )
    ).replace(/\n+$/, "");
    if (!password) throw new Error("The database password file is empty");
    const host = process.env.DB_HOST || "mysql";
    const port = process.env.DB_PORT || "3306";
    const user = encodeURIComponent(process.env.DB_USER || "word_atlas");
    const database = encodeURIComponent(
      process.env.DB_DATABASE || "word_atlas",
    );
    process.env.MYSQL_URL = `mysql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  }

  const config = parseEnv(process.env);
  const pool = createPool(config.MYSQL_URL);
  try {
    await migrate(pool);
    console.log("MySQL schema is ready.");
  } finally {
    await pool.end();
  }
  if (mode === "serve") await import("../dist/server.js");
}

start().catch((error) => {
  console.error(
    "API startup failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
