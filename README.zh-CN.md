![logo](./docs/assets/screenshots/logo.png)

[English](./README.md) | 中文

## Lumina 是什么？

Lumina 是一个信息管理工作台，通过 Web 应用 + FastAPI 后端 + 浏览器扩展，帮助你完成网页采集、AI 解读与阅读管理。

## 核心功能

- **浏览器采集工作流**：支持全文/选区一键采集（弹窗与右键菜单），并内置最近采集与错误日志。
- **结构化文章库管理**：支持按分类、作者、来源、时间等高级筛选，并提供批量操作能力。
- **深度阅读体验**：详情页支持原文/译文切换、沉浸模式、目录导航、批注与评论。
- **AI 解读流水线**：可生成摘要、大纲、要点、翻译与相关文章推荐，后台任务支持监控与重试。
- **后台控制中心**：集中管理模型 API（通用/向量）、提示词、推荐策略、分类与站点配置。
- **运维与可观测能力**：提供 AI 任务与调用计量（次数/Tokens/费用）以及评论状态监控。
- **内容生命周期管理**：支持本地媒体存储/压缩/清理，以及 JSON 备份导出与增量导入恢复。
- **多语言与权限模型**：内置中英文界面，支持访客浏览与管理员鉴权管理流程。

## 使用流程

```mermaid
flowchart LR
    A["插件采集文章"] --> B["后端保存内容"]
    B --> C["创建 AI 任务"]
    C --> D["Worker 执行 AI 解读"]
    D --> E["Web 端阅读与管理"]
    E --> F["导出内容"]
```

## 页面截图
### 1) 主页

![主页](./docs/assets/screenshots/00-home-desktop.png)

### 2) 列表页

![列表页](./docs/assets/screenshots/01-home-list-desktop.png)

### 3) 文章详情页
- **普通模式（默认）**：显示原文、全文批注、划线批注、目录、AI 解读和推荐阅读等。

![详情页](./docs/assets/screenshots/02-article-detail-ai-panel.png)

- **沉浸模式**：宽屏模式，隐藏导航栏，专注于文章内容。

![沉浸模式](./docs/assets/screenshots/02-article-detail-immersive.png)

### 4) 管理后台

- **监控模块**：支持模型调用记录/计费、AI任务和评论数据监控。

![监控模块](./docs/assets/screenshots/03-admin-dashboard-monitoring.png)

- **设置模块**：支持基础、分类、AI、评论和文件存储等配置。

![设置模块](./docs/assets/screenshots/03-admin-dashboard-settings.png)

### 5) 扩展插件
[下载地址](https://github.com/shawnxie94/lumina/releases)

- **全文一键采集**：不选中内容，点击插件采集按钮或页面右键采集。

![采集按钮](./docs/assets/screenshots/04-extension-popup-capture-button.png)

- **选区一键采集**：选中内容后，点击插件采集按钮或页面右键采集。

![选区采集](./docs/assets/screenshots/04-extension-popup-capture-select.png)

### 6) 其他功能
- **主题切换**：支持明亮/暗黑模式。

![暗黑](./docs/assets/screenshots/05-page-style-dark.png)

- **最近阅读记录**：显示最近阅读的5篇内容，方便快速跳转。

![最近阅读](./docs/assets/screenshots/05-page-recent-read.png)

- **文章评论**：支持在详情页对文章进行评论，方便交流与反馈。

![评论](./docs/assets/screenshots/05-page-comments.png)

- **内容导出**：支持按分类导出文章标题、头图和摘要。

![导出](./docs/assets/screenshots/05-page-export.png)

更多功能迭代中...

## 快速开始

```bash
docker-compose up -d
./scripts/docker_healthcheck.sh
```

访问地址：

- Web：<http://localhost:3000>
- API：<http://localhost:8000>

## 最小开发说明

```bash
# Frontend
cd frontend
npm install
npm run dev

# Backend
cd backend
uv sync
uv run uvicorn main:app --reload

# Extension
cd extension
npm install
npm run dev
```

## 常见问题

### API 为什么启动失败？

后端启动校验要求 `INTERNAL_API_TOKEN` 必填，请在环境变量或 Docker 配置中设置。

### 为什么无法登录后台？

首次使用需要先访问 `/login` 设置管理员密码，之后再正常登录。

### 为什么前端请求接口返回 404（如 `/backend/api/articles`）？

优先检查 `API_BASE_URL`。同源环境通常应为 `/backend`；本地前后端分端口时可设置为 `http://localhost:8000/backend`。

### 扩展为什么无法提交文章？

请检查扩展中的 API 地址配置，并确认浏览器可以访问后端接口。

## 许可证

MIT License
