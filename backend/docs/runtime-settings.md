# 运行时配置说明（settings）

配置入口：`backend/app/core/settings.py`

- 所有后端环境变量由 `AppSettings` 统一加载。
- 默认读取 `backend/.env`，也支持容器/进程环境变量覆盖。
- `create_app()` 与 `worker.main()` 启动时都会执行 `validate_startup_settings()`，配置非法会直接失败（fail-fast）。

## 分组

- `database`: 数据库连接
- `security`: 内部调用令牌
- `media`: 媒体存储/访问
- `ai_worker`: Worker 轮询与超时
- `cors`: 前端跨域来源

## 环境变量默认值

| 分组 | 变量名 | 默认值 | 说明 |
|---|---|---|---|
| database | `DATABASE_URL` | `sqlite:///./data/articles.db` | SQLAlchemy 连接串 |
| security | `INTERNAL_API_TOKEN` | 无（必填） | 内部请求校验 token；未设置将导致启动失败 |
| cors | `ALLOWED_ORIGINS` | 空字符串 | 为空时允许 localhost:3000/127.0.0.1:3000 |
| media | `MEDIA_ROOT` | `backend/data/media` | 媒体文件存储目录 |
| media | `MEDIA_BASE_URL` | `/backend/media` | 媒体静态路由前缀 |
| media | `MEDIA_PUBLIC_BASE_URL` | 空字符串 | 对外访问域名前缀（可选） |
| media | `MAX_MEDIA_SIZE` | `8388608` | 上传文件最大字节数（8MB） |
| ai_worker | `AI_WORKER_POLL_INTERVAL` | `3.0` | 任务轮询间隔（秒） |
| ai_worker | `AI_TASK_LOCK_TIMEOUT` | `300` | 任务锁超时（秒） |
| ai_worker | `AI_TASK_TIMEOUT` | `900` | 单任务执行超时（秒） |
| ai_worker | `AI_WORKER_ID` | 随机 UUID | Worker 实例标识 |

## 约束校验规则

- `DATABASE_URL`、`MEDIA_ROOT` 不能为空。
- `MAX_MEDIA_SIZE` 必须大于 0。
- `AI_WORKER_POLL_INTERVAL`、`AI_TASK_LOCK_TIMEOUT`、`AI_TASK_TIMEOUT` 必须大于 0。
- `AI_TASK_TIMEOUT` 不能小于 `AI_TASK_LOCK_TIMEOUT`。
- `MEDIA_BASE_URL` 必须以 `/` 开头。
- `MEDIA_PUBLIC_BASE_URL` 非空时必须以 `http://` 或 `https://` 开头。

## ALLOWED_ORIGINS 写法

支持两种格式：

1. 逗号分隔：`ALLOWED_ORIGINS=http://localhost:3000,https://app.example.com`
2. JSON 数组：`ALLOWED_ORIGINS=["http://localhost:3000","https://app.example.com"]`

全开放：`ALLOWED_ORIGINS=*`
