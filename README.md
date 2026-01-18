# 文章知识库系统

一个基于 AI 的个人文章知识库管理系统，支持浏览器扩展采集、AI 自动摘要、分类管理和文章导出。

## 功能特性

- ✅ 浏览器扩展一键采集文章
- ✅ AI 自动生成文章摘要
- ✅ 文章分类管理
- ✅ 文章列表和详情展示
- ✅ 文章导出功能
- ✅ 响应式设计，支持移动端

## 技术栈

### 前端
- Next.js 14.x (CSR 模式)
- React 18.x
- Tailwind CSS 3.x
- Axios

### 后端
- FastAPI 0.104.x
- SQLAlchemy 2.x
- OpenAI API
- SQLite
- uv（Python 包管理器）

### 浏览器扩展
- WXT
- @mozilla/readability
- Turndown

## 项目结构

```
article-database/
├── backend/              # FastAPI 后端服务
│   ├── models.py        # 数据库模型
│   ├── ai_client.py     # AI 客户端
│   ├── article_service.py  # 文章服务
│   ├── main.py         # FastAPI 主应用
│   ├── pyproject.toml  # 项目配置和依赖
│   └── Dockerfile
├── frontend/            # Next.js 前端应用
│   ├── pages/          # 页面组件
│   ├── lib/            # API 客户端
│   ├── styles/         # 样式文件
│   ├── package.json
│   └── Dockerfile
├── extension/           # 浏览器扩展
│   ├── entrypoints/    # 扩展入口
│   ├── icon/          # 图标文件
│   ├── package.json
│   └── wxt.config.ts
├── data/              # 数据存储目录
├── docker-compose.yml # Docker 编排配置
└── README.md
```

## 快速启动

### 前置要求

- Docker 和 Docker Compose
- OpenAI API Key
- uv（Python 包管理器）

### 1. 克隆项目

```bash
git clone <repository-url>
cd article-database
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，设置你的 OpenAI API Key：

```
OPENAI_API_KEY=your-openai-api-key-here
```

### 3. 启动服务

```bash
docker-compose up -d
```

服务启动后，访问：
- 前端应用: http://localhost:3000
- 后端 API: http://localhost:8000
- API 文档: http://localhost:8000/docs

### 4. 安装浏览器扩展

1. 进入扩展目录：
```bash
cd extension
```

2. 安装依赖：
```bash
npm install
```

3. 构建扩展：
```bash
npm run build
```

4. 在浏览器中加载扩展：
   - Chrome/Edge: 打开 `chrome://extensions/`
   - 点击"加载已解压的扩展程序"
   - 选择 `extension/.output/chrome-mv3` 目录

## 使用指南

### 采集文章

1. 在浏览器中打开任意文章页面
2. 点击浏览器扩展图标
3. 选择分类
4. 点击"确定采集"
5. 等待 AI 生成摘要完成

### 管理文章

1. 访问 http://localhost:3000
2. 查看文章列表
3. 点击"查看详情"查看完整内容
4. 使用分类筛选和搜索功能

### 管理分类

1. 点击"管理分类"按钮
2. 创建新分类
3. 设置分类名称、描述和颜色
4. 删除不需要的分类

### 导出文章

1. 在文章列表中选择要导出的文章
2. 点击"导出"按钮
3. 下载 Markdown 格式的文件

## 本地开发

### 后端开发

```bash
cd backend
uv sync
uv run uvicorn main:app --reload
```

### 前端开发

```bash
cd frontend
npm install
npm run dev
```

### 扩展开发

```bash
cd extension
npm install
npm run dev
```

## API 文档

### 文章接口

- `POST /api/articles` - 创建文章
- `GET /api/articles` - 获取文章列表
- `GET /api/articles/{id}` - 获取文章详情
- `DELETE /api/articles/{id}` - 删除文章

### 分类接口

- `GET /api/categories` - 获取分类列表
- `POST /api/categories` - 创建分类
- `DELETE /api/categories/{id}` - 删除分类

### 导出接口

- `POST /api/export` - 导出文章

详细的 API 文档请访问：http://localhost:8000/docs

## 数据库

项目使用 SQLite 作为数据库，数据存储在 `data/articles.db` 文件中。

数据库表结构：
- `articles` - 文章表
- `categories` - 分类表
- `ai_analyses` - AI 分析表
- `ai_configs` - AI 配置表

## 故障排查

### 服务无法启动

1. 检查端口是否被占用：
```bash
lsof -i :3000  # 检查前端端口
lsof -i :8000  # 检查后端端口
```

2. 查看容器日志：
```bash
docker-compose logs web
docker-compose logs api
```

### AI 生成失败

1. 检查 OpenAI API Key 是否正确
2. 检查 API Key 是否有足够的额度
3. 查看后端日志了解详细错误

### 扩展无法采集

1. 确保后端服务正在运行
2. 检查扩展的网络请求是否被阻止
3. 查看扩展的调试信息

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题，请提交 Issue 或联系项目维护者。