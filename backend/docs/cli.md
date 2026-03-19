# Lumina CLI

Lumina CLI (`lumina-cli`) 是面向 Agent 和自动化场景设计的命令行入口，适合 OpenClaw 这类通过本地命令调用工具的宿主，也适合日常脚本化运维。

## 安装

```bash
cd backend
uv sync
```

命令入口由后端包直接提供：

```bash
uv run lumina-cli --help
```

## 模式

CLI 支持两种执行模式：

- `local`
  直接复用本地数据库和后端 domain/service，不依赖 Web/API 服务已启动。
- `remote`
  通过现有 `/backend/api/*` 调用已经运行中的 Lumina 后端。

模式选择规则：

1. 显式传入 `--mode` 时，以 `--mode` 为准。
2. 未传 `--mode` 时，只要存在 `--base-url` 或 `LUMINA_BASE_URL`，就自动使用 `remote`。
3. 其余情况默认使用 `local`。

## 全局参数

```bash
lumina-cli \
  [--mode local|remote] \
  [--json] \
  [--base-url URL] \
  [--database-url URL] \
  [--admin-token TOKEN] \
  [--password PASSWORD] \
  [--timeout SECONDS]
```

说明：

- `--json`
  返回稳定的机器可读 JSON，推荐 Agent 场景统一开启。
- `--base-url`
  远程模式的后端基地址，例如 `http://localhost:8000/backend`。
- `--database-url`
  本地模式下覆盖默认数据库连接。
- `--admin-token`
  远程模式下直接使用管理员 JWT。
- `--password`
  远程模式下用管理员密码自动登录换取 JWT。
- `--timeout`
  远程模式请求超时时间，单位秒。

环境变量：

- `LUMINA_BASE_URL`
- `LUMINA_ADMIN_TOKEN`
- `LUMINA_ADMIN_PASSWORD`

## JSON 输出约定

成功时：

```json
{
  "ok": true,
  "mode": "local",
  "command": "article.list",
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "mode": "remote",
  "command": "article.get",
  "error": {
    "code": "not_found",
    "message": "文章不存在",
    "details": "文章不存在"
  }
}
```

退出码：

- `0` 成功
- `2` 参数错误或输入校验失败
- `3` 配置、鉴权或前置条件失败
- `4` not found / conflict / 当前状态不可执行
- `5` 远程调用失败或未分类运行时错误

## 命令总览

### 文章

```bash
lumina-cli article list
lumina-cli article get <article-slug>
lumina-cli article create [--input FILE|-]
lumina-cli article report-url [--input FILE|-]
lumina-cli article update <article-slug> [--input FILE|-]
lumina-cli article delete <article-slug>
lumina-cli article export
lumina-cli article retry <article-slug>
lumina-cli article retry-translation <article-slug>
lumina-cli article generate <article-slug> <summary|key_points|outline|quotes>
```

### 分类

```bash
lumina-cli category list
```

### AI 任务

```bash
lumina-cli task list
lumina-cli task get <task-id>
lumina-cli task timeline <task-id>
lumina-cli task retry [--input FILE|-]
lumina-cli task cancel [--input FILE|-]
```

### 系统与数据库

```bash
lumina-cli system doctor
lumina-cli db migrate
```

## 常见用法

### 1. 本地模式检查系统状态

```bash
cd backend
uv run lumina-cli --mode local --json system doctor
```

如果数据库缺表，返回的 `error.details.database.missing_tables` 会列出缺失表，并提示执行：

```bash
uv run lumina-cli --mode local db migrate
```

### 2. 获取文章筛选列表

```bash
uv run lumina-cli --mode local --json article list \
  --page 1 \
  --size 20 \
  --search "agent" \
  --category-id CATEGORY_ID \
  --author "Alice" \
  --source-domain example.com \
  --published-at-start 2026-01-01 \
  --published-at-end 2026-03-01 \
  --sort-by created_at_desc
```

`article list` 支持的主要筛选项：

- `--page`
- `--size`
- `--category-id`
- `--search`
- `--source-domain`
- `--author`
- `--is-visible`
- `--published-at-start`
- `--published-at-end`
- `--created-at-start`
- `--created-at-end`
- `--sort-by`

JSON 返回中的列表结果位于：

- `data.items`
- `data.pagination`

### 3. 从 JSON 创建文章

```bash
cat <<'EOF' | uv run lumina-cli --mode local --json article create --input -
{
  "title": "CLI article",
  "content_md": "hello from cli",
  "source_url": "https://example.com/cli",
  "author": "Lumina Bot",
  "skip_ai_processing": true
}
EOF
```

### 4. 通过 URL 采集文章

```bash
uv run lumina-cli --mode local --json article report-url \
  --url "https://example.com/article" \
  --is-visible true \
  --skip-ai-processing false
```

### 5. 更新文章

```bash
uv run lumina-cli --mode local --json article update my-article \
  --title "New title" \
  --author "Updated Author"
```

也可以使用 JSON 输入：

```bash
cat <<'EOF' | uv run lumina-cli --mode local --json article update my-article --input -
{
  "title": "New title",
  "is_visible": true,
  "category_id": "category-123"
}
EOF
```

### 6. 导出文章 Markdown

按 slug 导出：

```bash
uv run lumina-cli --mode local --json article export \
  --article-slug article-a \
  --article-slug article-b
```

按筛选条件导出：

```bash
uv run lumina-cli --mode local --json article export \
  --category-id CATEGORY_ID \
  --search "AI" \
  --public-base-url http://localhost:3000
```

返回内容位于 `data.content`。

### 7. 查看和操作 AI 任务

```bash
uv run lumina-cli --mode local --json task list --status failed
uv run lumina-cli --mode local --json task get TASK_ID
uv run lumina-cli --mode local --json task timeline TASK_ID
```

重试任务：

```bash
uv run lumina-cli --mode local --json task retry \
  --task-id TASK_1 \
  --task-id TASK_2
```

取消任务：

```bash
cat <<'EOF' | uv run lumina-cli --mode local --json task cancel --input -
{
  "task_ids": ["TASK_1", "TASK_2"]
}
EOF
```

### 8. 远程模式调用

使用管理员 token：

```bash
uv run lumina-cli \
  --mode remote \
  --base-url http://localhost:8000/backend \
  --admin-token "$LUMINA_ADMIN_TOKEN" \
  --json article get my-article-slug
```

使用管理员密码自动登录：

```bash
uv run lumina-cli \
  --mode remote \
  --base-url http://localhost:8000/backend \
  --password 'your-admin-password' \
  --json article list
```

## Agent 接入建议

对于 OpenClaw 或其他 Agent 宿主，推荐：

1. 一律开启 `--json`
2. 只解析标准输出中的 JSON，不依赖人类文本
3. 将失败处理建立在 `ok=false` 和进程退出码上
4. 对写操作尽量通过 `--input -` 传入 JSON，避免命令行转义复杂度

最小示例：

```bash
uv run lumina-cli --mode local --json article list --page 1 --size 20
```

## 注意事项

- `local` 模式不会调用 FastAPI app factory，因此不会依赖 `INTERNAL_API_TOKEN`。
- `local` 模式写数据库时，不会主动失效已经运行中的 Web/API 进程内公共缓存；如果要求页面或远程 API 立刻反映变更，优先使用 `remote`。
- `db migrate` 仅支持 `local` 模式。
