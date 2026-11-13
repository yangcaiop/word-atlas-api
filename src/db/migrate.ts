import { config as loadEnv } from "dotenv";
import { parseEnv } from "../config/env.js";
import { createPool, migrate } from "./mysql.js";
loadEnv({ quiet: true });
const config = parseEnv(process.env);
const pool = createPool(config.MYSQL_URL);
try {
  await migrate(pool);
  console.log("MySQL tables are ready.");
} finally {
  await pool.end();
}
