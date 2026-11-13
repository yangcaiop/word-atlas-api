# Docker 部署

在服务器上运行 API 和 MySQL 8.4。镜像构建、启动脚本、健康检查及配置模板均放在 `docker/`；根目录的 `docker-compose.yml` 引用已构建的镜像，负责服务依赖、配置挂载、端口、网络和数据卷。

## 首次部署

服务器需要 Docker Engine、Docker Compose v2 和 OpenSSL。以下命令在 `word-atlas-api` 根目录执行，无需在宿主机安装 Node.js 或 MySQL。

```bash
# 复制运行配置，并生成数据库密码；重复执行会保留已有配置和密码
sh docker/setup.sh
```

修改 `docker/api/api.env`：

```dotenv
CORS_ORIGINS=https://你的前端域名
```

来源只包含协议、域名和可选端口，不带页面路径；多个来源用逗号分隔。正式访问使用 HTTPS，保留 `COOKIE_SECURE=true`。`TRUST_PROXY_HOPS=1` 对应服务器前的一层可信反向代理，接入边缘函数时按实际代理链调整。

```bash
# 在部署服务器上构建，生成与服务器 CPU 架构一致的本地镜像
sh docker/build.sh

# MySQL 健康后启动 API，API 自动创建缺失的数据表
docker compose up -d --wait --wait-timeout 180

docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

生成的镜像为 `word-atlas-api:latest` 和 `word-atlas-mysql:8.4`，Compose 直接使用本地镜像。API 使用 Node.js 22，经过多阶段构建后只保留编译产物和生产依赖，并以普通 `node` 用户运行。

`docker-compose.yml` 仅引用构建好的镜像，没有 `build` 配置，因此 `docker compose build` 不会执行构建。请使用 `sh docker/build.sh`。

### 国内服务器的镜像与依赖源

构建脚本支持通过环境变量指定基础镜像和 npm 源，默认仍使用 Docker Hub 和 npm 官方源。服务器无法直连 Docker Hub 时，可以按部署环境选择可用的镜像代理，例如：

```bash
NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim \
MYSQL_IMAGE=docker.m.daocloud.io/library/mysql:8.4 \
NPM_REGISTRY=https://registry.npmmirror.com/ \
sh docker/build.sh
```

基础镜像可使用 `镜像地址@sha256:摘要` 固定版本。npm 依赖继续使用锁文件中的完整性校验。此方式只影响本次构建，不修改宿主机的 Docker 或 npm 全局配置。

## 配置与数据

| 位置                                 | 用途                                         |
| ------------------------------------ | -------------------------------------------- |
| `docker/api/api.env`                 | API 来源白名单、会话、限流和数据库连接配置   |
| `docker/mysql/mysql.env`             | MySQL 初始化数据库名、应用账号和密码文件路径 |
| `docker/secrets/mysql_password`      | API 与 MySQL 共用的应用账号密码              |
| `docker/secrets/mysql_root_password` | 仅 MySQL 挂载的 root 密码                    |
| Compose 数据卷 `mysql_data`          | MySQL 数据、用户、会话和学习进度             |

实际配置和密码已加入 Git 忽略规则，并从 Docker 构建上下文中排除。项目根目录用于本地开发的 `.env` 不会进入镜像。密码通过只读文件挂载；API 入口自动编码密码并生成 `MYSQL_URL`，无需手写连接字符串。

默认数据库名和应用账号均为 `word_atlas`。如需修改，在首次启动前同时调整 `docker/api/api.env` 的 `DB_DATABASE`、`DB_USER` 和 `docker/mysql/mysql.env` 的 `MYSQL_DATABASE`、`MYSQL_USER`。容器内数据库地址使用服务名 `mysql`。

MySQL 初始化配置仅在数据卷为空时生效。已有数据后，修改密码文件或初始化账号配置不会自动修改数据库内的账号；修改密码时需同时更新数据库账号和对应密码文件。`setup.sh` 不会重新生成已有密码。

## 端口与前端接入

API 默认仅映射到服务器 `127.0.0.1:3000`，由服务器上的 HTTPS 反向代理转发到它。MySQL 仅在 Compose 网络内可达，不映射宿主机端口。

如宿主机 3000 已被占用：

```bash
API_PORT=3001 docker compose up -d --wait --wait-timeout 180
```

可通过 `API_BIND` 调整绑定地址。后续使用相同的 `API_PORT`、`API_BIND` 执行更新命令，避免映射被恢复为默认值。

前端当前请求相对路径 `/api`。阿里云函数和 Pages 接入时，让同源 `/api/*` 转发至服务器的 HTTPS API，并保留 Cookie、Set-Cookie、Origin 和业务请求头；账号及同步接口应禁用边缘缓存。该代理配置需要在前端部署阶段完成。

## 更新与排查

```bash
# 更新代码后，重新构建并替换容器；MySQL 数据卷保留
sh docker/build.sh
docker compose up -d --wait --wait-timeout 180

# 查看状态和最近日志
docker compose ps
docker compose logs --tail=100 api mysql

# 手动执行建表命令（要求 MySQL 已运行且健康）
docker compose run --rm --no-deps api migrate

# 停止并移除容器和网络，保留数据卷
docker compose down
```

每次 API 启动都会执行幂等建表，不删除原有数据。MySQL 健康检查使用应用账号实际执行 `SELECT 1`；API 健康检查表示 HTTP 服务可响应。每个容器的 JSON 日志最多保留 3 个 10 MB 文件。

`docker compose down --volumes` 会删除数据库数据卷，只用于明确需要清空数据库的场景。正式更新前应备份数据库及 `docker/secrets/` 中的密码。
