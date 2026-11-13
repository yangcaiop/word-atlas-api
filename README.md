# Word Atlas API

独立的 Express 5 + TypeScript API 基础框架，使用 Node.js 22、ESM 和 npm。

当前提供环境变量校验、健康检查、CORS 来源白名单、HTTP 安全响应头、JSON 请求体大小限制、请求日志、统一错误处理及优雅退出。现已接入 MySQL 用户注册、登录、退出和按版本同步用户进度；无需 Redis。

## 本地启动

```bash
cd word-atlas-api
nvm use
npm ci
cp .env.example .env
npm run dev
```

如果已通过其他方式安装 Node.js 22，可以跳过 `nvm use`。`.nvmrc` 和 `package.json` 均限定 Node.js 22，npm 会拒绝在不兼容的 Node 版本下安装。

默认地址为 `http://127.0.0.1:3000`，修改源码后自动重启。

```bash
curl http://127.0.0.1:3000/api/health
```

响应示例（时间和运行时长随运行状态变化）：

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "word-atlas-api",
    "uptime": 10,
    "timestamp": "2026-11-13T04:00:00.000Z"
  }
}
```

健康检查目前只表示 HTTP 服务可响应。

## 配置

从项目根目录的 `.env` 加载配置，已有的系统环境变量优先。不要提交实际 `.env` 文件。

| 环境变量             | 默认值                                        | 说明                                                         |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`           | `development`                                 | `development`、`test` 或 `production`                        |
| `HOST`               | `127.0.0.1`                                   | 监听地址；容器或需要外部访问时设为 `0.0.0.0`                 |
| `PORT`               | `3000`                                        | 监听端口，范围 1–65535                                       |
| `LOG_LEVEL`          | `info`                                        | `fatal`、`error`、`warn`、`info`、`debug`、`trace`、`silent` |
| `CORS_ORIGINS`       | `http://localhost:5188,http://127.0.0.1:5188` | 允许的浏览器来源，逗号分隔；空字符串禁止所有跨域来源         |
| `JSON_BODY_LIMIT_MB` | `5`                                           | JSON 请求体大小上限，单位 MB，范围 1–30                      |

CORS 白名单默认匹配现有前端开发地址。无 `Origin` 头的请求可以访问接口；CORS 不是身份认证，后续业务接口仍需校验登录状态。账号使用 HttpOnly Cookie 会话，CORS 已启用 credentials。生产推荐与前端同源反向代理。

## 项目结构

```text
src/
├── app.ts                       # Express 应用与中间件组装，不监听端口
├── server.ts                    # 加载配置、监听端口、处理退出信号
├── config/env.ts                # 环境变量解析和校验
├── lib/
│   ├── app-error.ts             # 可公开返回的业务错误
│   └── logger.ts                # Pino JSON 日志
├── middleware/
│   ├── error-handler.ts         # 404 和统一错误响应
│   └── request-logger.ts        # 请求 ID、耗时和状态码
└── routes/
    ├── index.ts                 # /api 路由入口
    └── health.ts                # GET /api/health
test/
├── app.test.ts                  # HTTP 行为与配置校验
└── error-handler.test.ts        # 异步异常与错误信息保护
```

ESM 源码使用 `.js` 扩展名导入相对模块，TypeScript 会解析对应 `.ts` 文件，编译后可以直接由 Node.js 运行。

## 检查和生产运行

```bash
npm run typecheck
npm test
npm run build
# 一次完成以上检查
npm run check

# 生产运行，需先 build；以 .env 或部署环境变量配置 HOST、PORT 和 CORS_ORIGINS
NODE_ENV=production npm start
```

生产入口为 `dist/server.js`。可在普通 Node.js 服务器或容器运行，ESA Pages 可继续承载前端；此项目不是 ESA 边缘函数入口。生产环境通过 HTTPS 反向代理访问 API。`TRUST_PROXY_HOPS` 默认为 0；通过一层可信代理访问且 API 只允许该代理连接时设为 1，以正确识别限流 IP。

收到 `SIGINT` 或 `SIGTERM` 后，服务停止接收新连接，最多等待 10 秒完成现有请求，再退出。

## Docker 部署

API 和 MySQL 的镜像构建文件、启动脚本及配置模板位于 `docker/`，根目录 `docker-compose.yml` 负责服务编排、网络和持久化存储。

```bash
sh docker/setup.sh
# 编辑 docker/api/api.env，设置正式前端域名 CORS_ORIGINS
sh docker/build.sh
docker compose up -d --wait --wait-timeout 180
```

默认仅向服务器本机开放 `127.0.0.1:3000`，数据库无需单独安装，API 启动时自动建表。完整配置、HTTPS 接入和更新步骤见 [Docker 部署说明](docker/README.md)。

## 响应与日志

路由使用 `{ "success": true, "data": ... }` 返回成功结果。错误统一为：

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "接口不存在"
  },
  "requestId": "本次请求的唯一 ID"
}
```

每个请求都会生成 `X-Request-Id` 响应头。未知异常仅向客户端返回通用的 500 错误，详细异常写入服务端日志。HTTP 访问日志记录方法、路径、状态码和耗时，不包含请求体、查询字符串、Cookie 或 Authorization。

新增路由在 `src/routes/` 下创建并挂载到 `routes/index.ts`。Express 5 会将异步路由抛出的异常交给统一错误处理中间件；业务错误可使用 `AppError` 指定 HTTP 状态码和错误码。

## MySQL 初始化与账号同步

需要 MySQL 8.0（InnoDB / JSON）。先创建数据库：

```sql
CREATE DATABASE word_atlas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

在 .env 中配置连接（密码中的特殊字符需 URL 编码）：

```dotenv
MYSQL_URL=mysql://username:password@127.0.0.1:3306/word_atlas
SESSION_DAYS=30
AUTH_RATE_LIMIT=30
TRUST_PROXY_HOPS=0
```

```bash
npm run db:migrate
npm run dev
# 生产构建后可执行
npm run build
npm run db:migrate:prod
npm start
```

迁移只创建缺失的 users、auth_sessions、user_data 表，不删除数据。数据库账号需要建表及读写权限。生产默认 Secure Cookie，须通过 HTTPS 访问；本地 HTTP 默认关闭 Secure。默认会话 30 天，退出注销当前会话。密码用随机盐 scrypt 哈希，会话只保存令牌哈希。注册与登录每 IP 每 15 分钟共 30 次，可配置 AUTH_RATE_LIMIT。

| 接口                          | 说明                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| POST /api/auth/register       | {username,password,snapshot}，创建账号、初始数据、会话在同一事务提交。 |
| POST /api/auth/login          | {username,password}，返回用户、远程快照和版本，并设置 Cookie。         |
| POST /api/auth/logout         | {}，注销当前会话，保留远程进度。                                       |
| GET /api/auth/me              | 返回 {user}，无有效会话返回 401。                                      |
| GET /api/sync/word-atlas-open | 返回 {snapshot,revision,updatedAt}。                                   |
| PUT /api/sync/word-atlas-open | {baseRevision,snapshot}，整份替换；旧版本返回 409 DATA_CONFLICT。      |

同步 GET/PUT 和退出请求须携带 X-Atlas-User（当前用户 ID），服务端核对其与 Cookie 会话一致，防止跨标签页切换账号时错写数据。写请求使用 JSON，浏览器来源位于 CORS_ORIGINS。

snapshot 为 {progress,settings}。进度版本 2，词库为 word-atlas-open，session 固定 null；设置排除本机 dataset 与 onboarded。注册不需要邮箱、验证码，也不提供找回密码。

游客仅本地保存；注册上传游客初始进度；登录已有账号严格远程覆盖；登录后自动上传；退出后清空本地进度。数据库持久化用户进度和有效会话。所有账号、同步响应禁止缓存。

## MySQL 集成测试

普通 npm test 在未配置 MYSQL_TEST_URL 时明确跳过数据库集成测试。完整验证请提供专用测试库：

```bash
MYSQL_TEST_URL=mysql://username:password@127.0.0.1:3306/word_atlas_test npm run check
```

仅指定专用测试库。测试会建表、创建唯一后缀的账号并在结束时删除这些测试账号，覆盖账号流程、隔离、事务回滚和并发版本检查。
