import {
  Router,
  type Request,
  type Response,
  type CookieOptions,
} from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import type { Config } from "../config/env.js";
import { AccountRepository, type User } from "../db/mysql.js";
import { AppError } from "../lib/app-error.js";
import {
  credentialsSchema,
  snapshotSchema,
  uploadSchema,
  DATASET_ID,
} from "../sync/schema.js";
import { hashPassword, verifyPassword, tokenHash } from "./password.js";

const COOKIE = "word_atlas_session";
function sessionToken(req: Request): string | null {
  const value = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function accountRouter(
  config: Config,
  repository: AccountRepository,
): Router {
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE ?? config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: config.SESSION_DAYS * 86400000,
  };
  const setSession = (res: Response, token: string) =>
    res.cookie(COOKIE, token, cookieOptions);
  const expires = () => new Date(Date.now() + config.SESSION_DAYS * 86400000);
  const requireUser = async (req: Request): Promise<User> => {
    const token = sessionToken(req);
    const user = token ? await repository.userByToken(tokenHash(token)) : null;
    if (!user)
      throw new AppError(401, "UNAUTHENTICATED", "请重新登录后同步数据");
    return user;
  };
  router.use((req, _res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      if (!req.is("application/json"))
        throw new AppError(415, "JSON_REQUIRED", "请求必须使用 JSON");
      const origin = req.get("origin");
      if (origin && !config.CORS_ORIGINS.includes(origin))
        throw new AppError(403, "ORIGIN_NOT_ALLOWED", "请求来源不在允许列表中");
    }
    next();
  });
  const attempts = rateLimit({
    windowMs: 15 * 60000,
    limit: config.AUTH_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, "TOO_MANY_ATTEMPTS", "尝试次数过多，请稍后再试")),
  });
  // Use a fixed dummy hash so unknown users still pay the password derivation cost.
  const dummyHash = hashPassword(randomBytes(32).toString("hex"));
  router.post("/auth/register", attempts, async (req, res) => {
    const parsed = credentialsSchema
      .extend({ snapshot: snapshotSchema })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_INPUT",
        "用户名需为 3–32 位字母、数字或下划线，密码需为 8–128 位，学习数据需有效",
      );
    const { username, password, snapshot } = parsed.data;
    const user = { id: randomUUID(), username };
    const token = randomBytes(32).toString("hex");
    const data = await repository.create(
      user,
      await hashPassword(password),
      snapshot,
      tokenHash(token),
      expires(),
    );
    setSession(res, token);
    res.status(201).json({ success: true, data: { user, ...data } });
  });
  router.post("/auth/login", attempts, async (req, res) => {
    const parsed = credentialsSchema.strict().safeParse(req.body);
    if (!parsed.success)
      throw new AppError(400, "INVALID_INPUT", "请输入有效的用户名和密码");
    const row = await repository.userByName(parsed.data.username);
    const valid = await verifyPassword(
      parsed.data.password,
      row?.password_hash ?? (await dummyHash),
    );
    if (!row || !valid)
      throw new AppError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    const user = { id: row.id, username: row.username };
    const token = randomBytes(32).toString("hex");
    const data = await repository.login(user.id, tokenHash(token), expires());
    setSession(res, token);
    res.json({ success: true, data: { user, ...data } });
  });
  router.post("/auth/logout", async (req, res) => {
    const token = sessionToken(req);
    if (token) {
      const user = await repository.userByToken(tokenHash(token));
      if (user && req.get("X-Atlas-User") !== user.id)
        throw new AppError(
          409,
          "ACCOUNT_CHANGED",
          "登录账号已变化，请刷新页面",
        );
      await repository.logout(tokenHash(token));
    }
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    res.json({ success: true, data: null });
  });
  router.get("/auth/me", async (req, res) =>
    res.json({ success: true, data: { user: await requireUser(req) } }),
  );
  router.get("/sync/:datasetId", async (req, res) => {
    const user = await requireUser(req);
    if (req.get("X-Atlas-User") !== user.id)
      throw new AppError(409, "ACCOUNT_CHANGED", "登录账号已变化，请重新登录");
    if (req.params.datasetId !== DATASET_ID)
      throw new AppError(400, "INVALID_DATASET", "仅支持公开词库同步");
    res.json({ success: true, data: await repository.read(user.id) });
  });
  router.put("/sync/:datasetId", async (req, res) => {
    const user = await requireUser(req);
    if (req.get("X-Atlas-User") !== user.id)
      throw new AppError(409, "ACCOUNT_CHANGED", "登录账号已变化，请重新登录");
    if (req.params.datasetId !== DATASET_ID)
      throw new AppError(400, "INVALID_DATASET", "仅支持公开词库同步");
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_SNAPSHOT",
        "学习数据格式或版本不支持，请保留本地备份",
      );
    res.json({
      success: true,
      data: await repository.upload(
        user.id,
        parsed.data.baseRevision,
        parsed.data.snapshot,
      ),
    });
  });
  return router;
}
