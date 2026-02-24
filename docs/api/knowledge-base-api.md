# Lumina 知识库 API 使用说明

本文档聚焦知识库能力相关接口：

- 文章列表获取（支持筛选）
- 文章详情获取（含正文与 AI 解读）
- 文章 URL 上报（只传 URL 自动抓取）

## 1. 基本信息

- Base URL：`http://localhost:8000/backend`
- API 文档（Swagger）：`http://localhost:8000/docs`
- 内容类型：`application/json`

## 2. 认证方式

支持两种认证方式：

### 2.1 管理员 Bearer Token

先登录获取 token：

```bash
curl -s "http://localhost:8000/backend/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"<admin-password>"}'
```

后续请求带上：

```http
Authorization: Bearer <admin-token>
```

### 2.2 Internal Token（服务间调用）

请求头带上：

```http
X-Internal-Token: <INTERNAL_API_TOKEN>
```

`INTERNAL_API_TOKEN` 来自后端运行环境变量。

### 2.3 各接口认证规则

- `GET /api/articles`：匿名可访问（仅返回可见文章）；Bearer/Internal 可访问全部
- `GET /api/articles/{article_slug}`：匿名可访问可见文章；Bearer/Internal 可访问全部
- `POST /api/articles/report-url`：必须 Bearer 或 Internal（二选一）

## 3. 获取文章列表

`GET /api/articles`

### 3.1 查询参数

- `page`：页码，默认 `1`
- `size`：每页数量，默认 `20`
- `category_id`
- `search`
- `source_domain`
- `author`
- `is_visible`（仅鉴权用户可用）
- `published_at_start`
- `published_at_end`
- `created_at_start`
- `created_at_end`
- `sort_by`（默认 `created_at_desc`）

### 3.2 示例

```bash
curl -s "http://localhost:8000/backend/api/articles?page=1&size=20&search=ai&source_domain=example.com"
```

### 3.3 响应结构

```json
{
  "data": [
    {
      "id": "string",
      "slug": "string",
      "title": "string",
      "summary": "string",
      "top_image": "string",
      "category": { "id": "string", "name": "string", "color": "string" },
      "author": "string",
      "status": "pending|processing|completed|failed",
      "source_domain": "string",
      "published_at": "string|null",
      "created_at": "string",
      "is_visible": true,
      "original_language": "zh|en|..."
    }
  ],
  "pagination": {
    "page": 1,
    "size": 20,
    "total": 123,
    "total_pages": 7
  }
}
```

## 4. 获取文章详情

`GET /api/articles/{article_slug}`

### 4.1 示例

```bash
curl -s "http://localhost:8000/backend/api/articles/<article-slug>"
```

### 4.2 响应说明

返回文章基础信息 + 正文 + AI 解读：

- 正文字段：`content_html`、`content_md`、`content_trans`
- AI 字段：`ai_analysis.summary`、`key_points`、`outline`、`quotes` 及各自状态
- 导航字段：`prev_article`、`next_article`

## 5. URL 上报文章

`POST /api/articles/report-url`

服务端会同步抓取 URL 内容并入库，然后走既有清洗/AI 流程。

### 5.1 请求体

```json
{
  "url": "https://example.com/post/123",
  "category_id": "optional-category-id",
  "is_visible": false,
  "skip_ai_processing": false
}
```

- `url`：必填，仅支持 `http/https`
- `category_id`：可选
- `is_visible`：可选，默认沿用系统默认（通常为 `false`）
- `skip_ai_processing`：可选，默认 `false`

### 5.2 Bearer 调用示例

```bash
curl -s "http://localhost:8000/backend/api/articles/report-url" \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/post/123",
    "category_id": "optional-category-id",
    "is_visible": false,
    "skip_ai_processing": false
  }'
```

### 5.3 Internal Token 调用示例

```bash
curl -s "http://localhost:8000/backend/api/articles/report-url" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/post/123"
  }'
```

### 5.4 成功响应（200）

```json
{
  "id": "string",
  "slug": "string",
  "status": "pending|processing|completed",
  "source_url": "https://example.com/post/123"
}
```

### 5.5 重复 URL 响应（409）

```json
{
  "code": "source_url_exists",
  "existing": {
    "id": "string",
    "slug": "string",
    "title": "string",
    "status": "string"
  }
}
```

### 5.6 常见错误码

- `400`：URL 不合法、页面内容为空、内容过大等
- `401/403`：认证失败
- `415`：目标 URL 不是 HTML 页面
- `502`：抓取失败（网络或上游异常）
- `504`：抓取超时

## 6. 安全与限制

- URL 上报默认禁止访问内网/本机地址（如 `localhost`、`127.0.0.1`、`10.x`、`172.16-31.x`、`192.168.x`、`::1`）
- 同一 `source_url` 在系统内唯一，重复上报返回 `409`
