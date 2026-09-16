# Lumina Nginx 与 Cloudflare 性能配置留档

更新时间：2026-04-30

本文记录 `lumina.shawnxie.top` 当前生产环境的 nginx 与 Cloudflare
缓存/限流配置，用于后续排查访问不通、图片回源、RSS 缓存、动态接口误缓存等问题。

## 配置目标

- 动态页面、登录态接口、管理接口默认不缓存。
- `/_next/static/*`、`/backend/media/*` 复用 Cloudflare 边缘缓存。
- `/backend/media/*` 由 nginx 直接读取磁盘文件，避免图片请求占用 FastAPI。
- RSS 使用 nginx 短缓存和 Cloudflare 边缘缓存，降低重复请求成本。
- nginx 识别 Cloudflare 转发的真实客户端 IP。
- 只对登录、任务重试、上传、备份等写路径加轻量限流。

## 生产位置

- Compose 目录：`/www/server/panel/data/compose/lumina`
- 媒体目录：`/www/server/panel/data/compose/lumina/data/media`
- 主 vhost：`/www/server/panel/vhost/nginx/lumina.shawnxie.top.conf`
- Cloudflare/限流 include：`/www/server/panel/vhost/nginx/0.lumina_edge.conf`
- 本次最终 vhost 备份：
  `/www/server/panel/vhost/nginx/lumina.shawnxie.top.conf.bak.20260430134633.edge-tune-no-dup-cache`

`https://www.lumina.shawnxie.top/` 暂时不用，不纳入本次配置目标。

## 缓存边界

Cloudflare 只允许缓存这些路径：

- `/_next/static/*`
- `/backend/media/*`
- `/backend/api/articles/rss.xml`
- `/backend/api/reviews/rss.xml`

Cloudflare 明确绕过这些路径：

- 非 `GET` / `HEAD` 请求
- `/admin*`
- `/login*`
- `/api/auth*`
- `/backend/api/auth*`
- `/backend/api/ai-tasks*`
- `/backend/api/settings*`
- `/backend/api/comments*`
- `/backend/api/media*`
- `/backend/api/backup*`

注意：`/backend/media/*` 是公开静态媒体文件，可缓存；
`/backend/api/media*` 是动态媒体接口，必须绕过缓存。

## Nginx 全局边缘配置

`/www/server/panel/vhost/nginx/0.lumina_edge.conf` 负责 Cloudflare 真实 IP
与限流 zone：

```nginx
real_ip_header CF-Connecting-IP;
real_ip_recursive on;

# Cloudflare 官方 IPv4 / IPv6 段，需要定期同步。
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

map $http_cf_connecting_ip $lumina_limit_key {
    "" $binary_remote_addr;
    default $http_cf_connecting_ip;
}

limit_req_zone $lumina_limit_key zone=lumina_auth:10m rate=1r/s;
limit_req_zone $lumina_limit_key zone=lumina_task_write:10m rate=2r/s;
limit_req_zone $lumina_limit_key zone=lumina_upload:10m rate=2r/s;
limit_req_zone $lumina_limit_key zone=lumina_backup:10m rate=1r/s;
```

## Nginx vhost 要点

TLS 只保留 1.2/1.3：

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
```

gzip 类型补充 RSS：

```nginx
gzip_types text/plain application/javascript application/x-javascript text/javascript text/css application/xml application/json image/jpeg image/gif image/png font/ttf font/otf image/svg+xml application/xml+rss application/rss+xml text/x-js;
```

位置匹配顺序要点：可缓存的精确/前缀路径放在动态兜底路径前面。

Next 静态资源走 nginx 源站缓存：

```nginx
location ^~ /_next/static/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_cache lumina_shawnxie_top_cache;
    proxy_cache_key "$scheme$request_method$host$request_uri|accept:$http_accept";
    proxy_cache_valid 200 30d;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_lock on;
    proxy_no_cache $upstream_http_set_cookie;
    add_header X-Proxy-Cache $upstream_cache_status always;
}
```

媒体文件由 nginx 直接服务：

```nginx
location ^~ /backend/media/ {
    alias /www/server/panel/data/compose/lumina/data/media/;
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
}
```

RSS 使用短缓存：

```nginx
location = /backend/api/articles/rss.xml {
    proxy_pass http://127.0.0.1:8000;
    proxy_cache lumina_shawnxie_top_cache;
    proxy_cache_key "$scheme$request_method$host$request_uri|accept:$http_accept";
    proxy_cache_valid 200 60s;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_lock on;
    proxy_cache_bypass $http_authorization;
    proxy_no_cache $http_authorization $upstream_http_set_cookie;
    add_header X-Proxy-Cache $upstream_cache_status always;
}

location = /backend/api/reviews/rss.xml {
    proxy_pass http://127.0.0.1:8000;
    proxy_cache lumina_shawnxie_top_cache;
    proxy_cache_key "$scheme$request_method$host$request_uri|accept:$http_accept";
    proxy_cache_valid 200 60s;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    proxy_cache_lock on;
    proxy_cache_bypass $http_authorization;
    proxy_no_cache $http_authorization $upstream_http_set_cookie;
    add_header X-Proxy-Cache $upstream_cache_status always;
}
```

动态兜底必须关闭 nginx cache：

```nginx
location ^~ /backend/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_cache off;
    add_header X-Proxy-Cache BYPASS always;
}

location ^~ / {
    proxy_pass http://127.0.0.1:3000;
    proxy_cache off;
    add_header X-Proxy-Cache BYPASS always;
}
```

限流路径：

```nginx
location ^~ /api/auth/ {
    limit_req zone=lumina_auth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
    add_header X-Proxy-Cache BYPASS always;
}

location ^~ /backend/api/auth/ {
    limit_req zone=lumina_auth burst=5 nodelay;
    proxy_pass http://127.0.0.1:8000;
    add_header X-Proxy-Cache BYPASS always;
}

location = /backend/api/ai-tasks/retry {
    limit_req zone=lumina_task_write burst=10 nodelay;
    proxy_pass http://127.0.0.1:8000;
    add_header X-Proxy-Cache BYPASS always;
}

location = /backend/api/media/upload {
    limit_req zone=lumina_upload burst=5 nodelay;
    proxy_pass http://127.0.0.1:8000;
    add_header X-Proxy-Cache BYPASS always;
}

location ^~ /backend/api/backup {
    limit_req zone=lumina_backup burst=3 nodelay;
    proxy_pass http://127.0.0.1:8000;
    add_header X-Proxy-Cache BYPASS always;
}
```

以上片段为了留档可读性省略了部分重复的 `proxy_set_header`。编辑线上 vhost
时，要保留现有转发头、超时和 WebSocket 相关配置。

## Cloudflare Cache Rules

Zone：`shawnxie.top`

Zone ID：

```text
e421bb9949b3a85cb792d7afbb74a67b
```

Ruleset ID：

```text
ba71775c44d54e9986c9ca3dcbd47ffb
```

规则一：`Lumina bypass private and mutating paths`

```cloudflare
(http.host eq "lumina.shawnxie.top" and (((http.request.method ne "GET" and http.request.method ne "HEAD")) or starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/login") or starts_with(http.request.uri.path, "/api/auth") or starts_with(http.request.uri.path, "/backend/api/auth") or starts_with(http.request.uri.path, "/backend/api/ai-tasks") or starts_with(http.request.uri.path, "/backend/api/settings") or starts_with(http.request.uri.path, "/backend/api/comments") or starts_with(http.request.uri.path, "/backend/api/media") or starts_with(http.request.uri.path, "/backend/api/backup")))
```

Action parameters：

```json
{"cache": false}
```

规则二：`Lumina cache static media, next assets, and RSS`

```cloudflare
(http.host eq "lumina.shawnxie.top" and (http.request.method eq "GET" or http.request.method eq "HEAD") and (starts_with(http.request.uri.path, "/_next/static/") or starts_with(http.request.uri.path, "/backend/media/") or http.request.uri.path eq "/backend/api/articles/rss.xml" or http.request.uri.path eq "/backend/api/reviews/rss.xml"))
```

Action parameters：

```json
{
  "browser_ttl": {
    "mode": "respect_origin"
  },
  "cache": true,
  "edge_ttl": {
    "mode": "bypass_by_default"
  }
}
```

Cloudflare Rulesets API 更新注意事项：先 GET 当前 entrypoint ruleset，保留
已有规则，再 PUT 完整 ruleset。`shawnxie.top` 的同一个 ruleset 里还有
Infinitum 规则，不能直接覆盖。

## 验证命令

reload 前先检查 nginx：

```bash
nginx -t
nginx -s reload
```

在服务器上验证源站行为：

```bash
curl -sSI -H "Host: lumina.shawnxie.top" http://127.0.0.1/ \
  | egrep -i "HTTP/|cache-control|x-proxy-cache"

curl -sSI -H "Host: lumina.shawnxie.top" http://127.0.0.1/backend/ \
  | egrep -i "HTTP/|cache-control|x-proxy-cache"

curl -sSI -H "Host: lumina.shawnxie.top" http://127.0.0.1/backend/api/articles/rss.xml \
  | egrep -i "HTTP/|cache-control|x-proxy-cache|content-type"

curl -sSI -H "Host: lumina.shawnxie.top" http://127.0.0.1/backend/api/articles/rss.xml \
  | egrep -i "HTTP/|cache-control|x-proxy-cache|content-type"
```

源站预期：

- `/`：`X-Proxy-Cache: BYPASS`
- `/backend/`：`X-Proxy-Cache: BYPASS`
- RSS 第一次：`X-Proxy-Cache: MISS`
- RSS 第二次：`X-Proxy-Cache: HIT`
- 媒体文件：`Cache-Control: public, max-age=31536000, immutable`

验证公网 Cloudflare 行为：

```bash
curl -sSI https://lumina.shawnxie.top/ \
  | egrep -i "HTTP/|cache-control|cf-cache-status|x-proxy-cache"

curl -sSI https://lumina.shawnxie.top/backend/api/articles/rss.xml \
  | egrep -i "HTTP/|cache-control|cf-cache-status|x-proxy-cache"

curl -sSI https://lumina.shawnxie.top/backend/api/articles/rss.xml \
  | egrep -i "HTTP/|cache-control|cf-cache-status|x-proxy-cache"
```

公网预期：

- `/`：`cf-cache-status: DYNAMIC`，`x-proxy-cache: BYPASS`
- `/backend/media/*`：预热后 `cf-cache-status: HIT`
- `/_next/static/*`：预热后 `cf-cache-status: HIT`
- RSS 第一次：`cf-cache-status: MISS`
- RSS 第二次：`cf-cache-status: HIT`

## 运维注意事项

- 不要缓存 HTML 页面，除非前端明确改造成页面级缓存安全。
- 不要泛缓存 `/backend/api/*`。多数 API 是动态、鉴权、任务或管理路径。
- Cloudflare 缓存规则保持 allowlist 模式，新公共接口要单独评估后加入。
- 区分媒体文件和媒体接口：
  `/backend/media/*` 可缓存，`/backend/api/media*` 必须绕过缓存。
- Cloudflare IP 段变更后，要更新 `0.lumina_edge.conf` 并执行 `nginx -t`。
- 临时 Cloudflare API token 用完后应删除。

## 回滚

nginx 异常时，恢复最近的 vhost 备份：

```bash
cp /www/server/panel/vhost/nginx/lumina.shawnxie.top.conf.bak.20260430134633.edge-tune-no-dup-cache \
  /www/server/panel/vhost/nginx/lumina.shawnxie.top.conf
nginx -t
nginx -s reload
```

Cloudflare 异常时，只禁用或删除 Lumina 相关两条 Cache Rules，不要删除同一
ruleset 内的 Infinitum 规则。
