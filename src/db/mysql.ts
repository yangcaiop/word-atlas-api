import mysql from "mysql2";
import {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
import { AppError } from "../lib/app-error.js";
import {
  snapshotSchema,
  DATASET_ID,
  type Snapshot,
  type RemoteData,
} from "../sync/schema.js";

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
    username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY,
    user_id CHAR(36) CHARACTER SET ascii NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    INDEX (expires_at), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS user_data (
    user_id CHAR(36) CHARACTER SET ascii NOT NULL,
    dataset_id VARCHAR(64) CHARACTER SET ascii NOT NULL,
    payload JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, dataset_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
];
export function createPool(url: string): Pool {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 5,
    timezone: "Z",
    connectTimeout: 5000,
    enableKeepAlive: true,
  });
  // Driver dates and SQL timestamps use the same UTC clock, regardless of server timezone.
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      if (error) connection.destroy();
    });
  });
  return pool.promise();
}
export async function migrate(pool: Pool) {
  for (const statement of schemaStatements) await pool.query(statement);
}
export interface User {
  id: string;
  username: string;
}
interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  password_hash: string;
}
interface DataRow extends RowDataPacket {
  payload: unknown;
  revision: number;
  updated_at: Date;
}
export class AccountRepository {
  constructor(readonly pool: Pool) {}
  async transaction<T>(
    operation: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  async userByName(username: string) {
    const [rows] = await this.pool.execute<UserRow[]>(
      "SELECT id, username, password_hash FROM users WHERE username = ?",
      [username],
    );
    return rows[0];
  }
  async userByToken(hash: string): Promise<User | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      "SELECT u.id, u.username FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)",
      [hash],
    );
    return rows[0] ? { id: rows[0].id, username: rows[0].username } : null;
  }
  async read(
    userId: string,
    connection: Pool | PoolConnection = this.pool,
  ): Promise<RemoteData> {
    const [rows] = await connection.execute<DataRow[]>(
      "SELECT payload, revision, updated_at FROM user_data WHERE user_id = ? AND dataset_id = ?",
      [userId, DATASET_ID],
    );
    const row = rows[0];
    if (!row)
      throw new AppError(500, "DATA_MISSING", "账号数据尚未初始化，请稍后重试");
    return {
      snapshot: snapshotSchema.parse(
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      ),
      revision: row.revision,
      updatedAt: row.updated_at.toISOString(),
    };
  }
  async create(
    user: User,
    passwordHash: string,
    snapshot: Snapshot,
    hash: string,
    expires: Date,
  ): Promise<RemoteData> {
    try {
      return await this.transaction(async (connection) => {
        await connection.execute(
          "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
          [user.id, user.username, passwordHash],
        );
        await connection.execute(
          "INSERT INTO user_data (user_id, dataset_id, payload) VALUES (?, ?, ?)",
          [user.id, DATASET_ID, JSON.stringify(snapshot)],
        );
        await connection.execute(
          "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
          [hash, user.id, expires],
        );
        return this.read(user.id, connection);
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      )
        throw new AppError(409, "USERNAME_TAKEN", "用户名已被使用");
      throw error;
    }
  }
  async login(
    userId: string,
    hash: string,
    expires: Date,
  ): Promise<RemoteData> {
    return this.transaction(async (connection) => {
      const data = await this.read(userId, connection);
      await connection.execute(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        [hash, userId, expires],
      );
      await connection.execute(
        "DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)",
      );
      return data;
    });
  }
  async logout(hash: string) {
    await this.pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [
      hash,
    ]);
  }
  async upload(
    userId: string,
    baseRevision: number,
    snapshot: Snapshot,
  ): Promise<RemoteData> {
    return this.transaction(async (connection) => {
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE user_data SET payload = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND dataset_id = ? AND revision = ?",
        [JSON.stringify(snapshot), userId, DATASET_ID, baseRevision],
      );
      if (result.affectedRows !== 1)
        throw new AppError(
          409,
          "DATA_CONFLICT",
          "远程数据已更新，请从远程获取",
        );
      return this.read(userId, connection);
    });
  }
}
