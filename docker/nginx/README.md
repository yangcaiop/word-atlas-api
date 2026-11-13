# Nginx 与 HTTPS

`word-api.yckara.top.conf` 对应 `word-api.yckara.top`，将 HTTPS 请求代理至服务器本机 `127.0.0.1:3000`。HTTP 除 ACME 验证路径外，统一跳转 HTTPS。API 和 MySQL 继续使用现有 Docker Compose 服务。

## 证书申请

域名 A 记录需指向服务器，公网需能访问 80 和 443 端口。使用 Certbot 的 HTTP-01 / webroot 验证，不需要 DNS API 凭据或手动添加 TXT 记录。

在安装最终 HTTPS 配置前，先创建 `/var/www/letsencrypt/.well-known/acme-challenge/`，并通过仅监听 80 的 Nginx 配置，将该验证路径的 `root` 设置为 `/var/www/letsencrypt`。证书文件尚不存在时，不能直接启用引用它们的 443 配置。

安装系统仓库中的 `certbot`，然后执行：

```bash
certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name word-api.yckara.top -d word-api.yckara.top \
  --non-interactive --agree-tos --register-unsafely-without-email
```

本部署按用户选择不填写 ACME 联系邮箱。证书私钥由 Certbot 保存在服务器 `/etc/letsencrypt/`，不复制进项目或镜像。

申请成功后，在 API 项目根目录安装配置：

```bash
install -m 644 docker/nginx/word-api.yckara.top.conf \
  /etc/nginx/conf.d/word-api.yckara.top.conf
nginx -t && systemctl reload nginx
```

## 自动续期

安装续期后的 Nginx 重载钩子和 systemd 定时任务：

```bash
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 docker/nginx/certbot-deploy-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/word-atlas-nginx.sh
install -m 644 docker/nginx/word-atlas-certbot-renew.service \
  /etc/systemd/system/word-atlas-certbot-renew.service
install -m 644 docker/nginx/word-atlas-certbot-renew.timer \
  /etc/systemd/system/word-atlas-certbot-renew.timer
systemctl daemon-reload
systemctl enable --now word-atlas-certbot-renew.timer
```

定时任务按服务器时区每天 03:00、15:00 检查，附加最多一小时的随机延迟；证书进入续期窗口后自动续期。续期成功后先执行 `nginx -t`，再平滑重载 Nginx。不要同时启用另一个 Certbot 续期 timer 或 cron。

```bash
certbot renew --cert-name word-api.yckara.top --dry-run
systemctl list-timers --all word-atlas-certbot-renew.timer
journalctl -u word-atlas-certbot-renew.service --since today --no-pager
```

## API 配置与检查

`docker/api/api.env` 保持 `COOKIE_SECURE=true`。当前仅一层 Nginx 代理，设置 `TRUST_PROXY_HOPS=1`；`CORS_ORIGINS` 填写允许调用接口的浏览器来源。部署先允许 API 自身来源 `https://word-api.yckara.top`，接入独立前端时再加入其实际来源。

```bash
docker compose up -d --no-deps --force-recreate --wait --wait-timeout 90 api
curl --fail https://word-api.yckara.top/api/health
```

Nginx 覆盖 `X-Forwarded-For`，避免客户端自带的转发头影响 Express 的 IP 限流。后续接入 ESA 代理时，需按新的代理链另行核对来源限制和客户端 IP 传递方式。
