# Lumina 知识库 API 使用说明

本文档聚焦知识库能力相关接口：

- 文章列表获取（支持筛选）
- 文章详情获取（含正文与 AI 解读）
- 文章内容创建（直接上传 HTML/Markdown）
- 文章 URL 上报（只传 URL 自动抓取）
- 文章导出（批量导出 Markdown）
- 备份导出（导出 JSON 备份）

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
- `POST /api/articles`：必须 Bearer 或 Internal（二选一）
- `POST /api/articles/report-url`：必须 Bearer 或 Internal（二选一）
- `POST /api/export`：必须 Bearer 或 Internal（二选一）
- `POST /api/backup/export-jobs/latest`：必须 Bearer 或 Internal（二选一）
- `GET /api/backup/export-jobs/latest`：必须 Bearer 或 Internal（二选一）
- `GET /api/backup/export-jobs/latest/download`：必须 Bearer 或 Internal（二选一）

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
      "original_language": "zh|en|...",
      "note_recommendation_level": "strongly_recommended|recommended|neutral|not_recommended"
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

`note_recommendation_level` 说明：

- `strongly_recommended`：强烈推荐
- `recommended`：推荐
- `neutral`：一般（默认值）
- `not_recommended`：不推荐

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
- 批注字段：`note_content`、`note_annotations`、`note_recommendation_level`

## 5. 创建文章

`POST /api/articles`

客户端可直接上传已提取的文章正文，适用于浏览器扩展、移动端 WebView 等已经能拿到页面内容的场景。

### 5.1 请求体

```json
{
  "title": "文章标题",
  "content_html": "<article>...</article>",
  "content_md": "Markdown 正文，可选",
  "source_url": "https://example.com/post/123",
  "top_image": "https://example.com/image.jpg",
  "author": "作者",
  "published_at": "2026-04-26",
  "source_domain": "example.com",
  "category_id": "optional-category-id",
  "skip_ai_processing": false
}
```

- `title`：必填
- `content_html` / `content_md`：至少提供一个
- `source_url`：可选；用于去重和来源跳转
- `skip_ai_processing`：可选，默认 `false`

### 5.2 Internal Token 调用示例

```bash
curl -s "http://localhost:8000/backend/api/articles" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "文章标题",
    "content_html": "<article>...</article>",
    "source_url": "https://example.com/post/123",
    "source_domain": "example.com",
    "skip_ai_processing": false
  }'
```

### 5.3 成功响应（200）

```json
{
  "id": "string",
  "slug": "string",
  "status": "pending|processing|completed"
}
```

### 5.4 重复 URL 响应（409）

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

## 6. URL 上报文章

`POST /api/articles/report-url`

服务端会同步抓取 URL 内容并入库，然后走既有清洗/AI 流程。

### 6.1 请求体

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

### 6.2 Bearer 调用示例

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

### 6.3 Internal Token 调用示例

```bash
curl -s "http://localhost:8000/backend/api/articles/report-url" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/post/123"
  }'
```

### 6.4 成功响应（200）

```json
{
  "id": "string",
  "slug": "string",
  "status": "pending|processing|completed",
  "source_url": "https://example.com/post/123"
}
```

### 6.5 重复 URL 响应（409）

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

### 6.6 常见错误码

- `400`：URL 不合法、页面内容为空、内容过大等
- `401/403`：认证失败
- `415`：目标 URL 不是 HTML 页面
- `502`：抓取失败（网络或上游异常）
- `504`：抓取超时

## 7. 导出接口

### 7.1 文章导出

`POST /api/export`

### 7.1.1 请求体

```json
{
  "article_slugs": ["article-slug-1", "article-slug-2"],
  "category_id": "optional-category-id",
  "search": "optional-keyword",
  "source_domain": "example.com",
  "author": "Alice",
  "is_visible": true,
  "published_at_start": "2026-01-01",
  "published_at_end": "2026-01-31",
  "created_at_start": "2026-01-01",
  "created_at_end": "2026-01-31"
}
```

- 支持两种导出模式（`article_slugs` 优先）：
  - 模式 A：按 slug 列表导出，传 `article_slugs`
  - 模式 B：按筛选条件导出，`article_slugs` 不传，改传筛选字段
- `article_slugs`：可选，`string[]`，要导出的文章 slug 列表
- 筛选字段（均可选）：`category_id`、`search`、`source_domain`、`author`、`is_visible`、`published_at_start`、`published_at_end`、`created_at_start`、`created_at_end`
- 校验规则：当 `article_slugs` 未提供时，至少需要一个筛选字段
- 兼容行为：当 `article_slugs` 传空数组时，接口返回空内容字符串

### 7.1.2 Bearer 调用示例

```bash
curl -s "http://localhost:8000/backend/api/export" \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "article_slugs": ["article-slug-1", "article-slug-2"]
  }'
```

### 7.1.3 Internal Token 调用示例（按筛选条件导出）

```bash
curl -s "http://localhost:8000/backend/api/export" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "category_id": "optional-category-id",
    "search": "ai",
    "source_domain": "example.com",
    "author": "Alice"
  }'
```

### 7.1.4 成功响应（200）

```json
{
  "content": "## 分类A\n\n### [文章标题](http://localhost:8000/article/article-slug-1)\n\n摘要...",
  "filename": "articles_export.md"
}
```

### 7.1.5 常见错误码

- `400`：请求体非法或导出过程异常
- `401/403`：认证失败（未登录或 token 失效）

### 7.2 备份导出

备份导出现在采用“后台生成 + 状态查询 + 下载最新文件”的三段式流程。

#### 7.2.1 创建/复用最新备份任务

`POST /api/backup/export-jobs/latest`

- 无请求体
- 如果当前已有进行中的导出任务，接口会直接返回该任务状态，不会重复启动

Bearer 调用示例：

```bash
curl -s "http://localhost:8000/backend/api/backup/export-jobs/latest" \
  -X POST \
  -H "Authorization: Bearer <admin-token>"
```

成功响应（200）：

```json
{
  "status": "processing",
  "filename": "lumina-backup-latest.zip",
  "file_path": "/abs/path/to/data/backups/lumina-backup-latest.zip",
  "file_size": null,
  "error_message": null,
  "created_at": null,
  "started_at": "2026-04-12T12:00:00+00:00",
  "finished_at": null
}
```

#### 7.2.2 查询最新备份任务状态

`GET /api/backup/export-jobs/latest`

Internal Token 调用示例：

```bash
curl -s "http://localhost:8000/backend/api/backup/export-jobs/latest" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>"
```

状态字段说明：

- `idle`：尚未生成过备份
- `processing`：正在后台生成
- `completed`：最近一次生成成功，可下载
- `failed`：最近一次生成失败，`error_message` 会返回失败原因

#### 7.2.3 下载最新备份文件

`GET /api/backup/export-jobs/latest/download`

```bash
curl -L -OJ "http://localhost:8000/backend/api/backup/export-jobs/latest/download" \
  -H "Authorization: Bearer <admin-token>"
```

响应说明：

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="lumina-backup-latest.zip"`
- 当最新备份尚未生成或文件缺失时，返回 `404`

## 8. 安全与限制

- URL 上报默认禁止访问内网/本机地址（如 `localhost`、`127.0.0.1`、`10.x`、`172.16-31.x`、`192.168.x`、`::1`）
- 同一 `source_url` 在系统内唯一，重复上报返回 `409`
