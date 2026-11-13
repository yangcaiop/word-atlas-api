import { z } from "zod";

const originSchema = z.string().transform((value, context) => {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid origin");
    }
    return url.origin;
  } catch {
    context.addIssue({
      code: "custom",
      message: "必须是 HTTP(S) 来源，不包含页面路径、查询参数或凭据",
    });
    return z.NEVER;
  }
});

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5188,http://127.0.0.1:5188")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(originSchema)),
  MYSQL_URL: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith("mysql://"),
      "必须使用 mysql:// 连接地址",
    )
    .default("mysql://root@127.0.0.1:3306/word_atlas"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  JSON_BODY_LIMIT_MB: z.coerce.number().int().min(1).max(30).default(5),
});

export function parseEnv(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量配置错误：${details}`);
  }
  return result.data;
}

export type Config = ReturnType<typeof parseEnv>;
