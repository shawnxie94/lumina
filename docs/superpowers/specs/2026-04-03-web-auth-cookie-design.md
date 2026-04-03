# Web Admin Auth via HttpOnly Cookie Design

## Summary

将 Lumina 的 Web 管理员认证从“`localStorage + Bearer token`”升级为“`HttpOnly cookie` 为主，`Bearer token` 兼容保留”的混合模式。

本次改造的目标是：

- 让 Next.js SSR 能识别管理员身份
- 移除隐藏文章详情页对 `admin_preview` URL 参数的依赖
- 让列表页在管理员场景下 SSR 直接返回正确可见性结果，避免客户端鉴权完成后再补一次请求
- 保持浏览器扩展继续使用现有 Bearer token 授权，不重做扩展认证链路
- 保证本地开发环境 `localhost:3000 -> localhost:8000` 同样可用

## Current State

当前 Web 端认证模型：

- 前端登录后将管理员 token 保存在 `localStorage` 的 `admin_token`
- axios 请求拦截器读取 `localStorage` 并附加 `Authorization: Bearer ...`
- 后端管理员依赖只检查 `Authorization` 头，不读取 cookie
- SSR 请求后端时不会透传浏览器登录态，因此服务端无法识别隐藏文章的管理员访问

这直接带来了两个问题：

- 隐藏文章详情页必须依赖 `admin_preview=1` 才能避免 SSR 直接返回 404
- 列表页首屏 SSR 无法直接拿到管理员可见数据，需要客户端完成鉴权后额外再拉取一次

## Goals

- Web 登录成功后由后端写入管理员 `HttpOnly cookie`
- 后端管理员鉴权支持“`Bearer` 优先，其次 `cookie`”
- Web 端不再依赖 `localStorage admin_token` 作为主鉴权来源
- SSR 请求后端时透传浏览器 cookie
- 删除 `admin_preview` 相关预览兜底逻辑
- 保持扩展 Bearer token 模式不变

## Non-Goals

- 不重构扩展授权模型
- 不将所有调用统一改为纯 cookie-only
- 不做复杂的老 token 自动迁移脚本
- 不顺手重构评论 OAuth 或 NextAuth 认证逻辑

## Proposed Approach

### 1. Backend: Mixed Auth Support

后端管理员认证从单一 Bearer 扩展为混合模式：

- 如果请求带 `Authorization: Bearer <token>`，按现有逻辑校验
- 如果没有 Bearer，则读取管理员 cookie 并校验
- `get_current_admin` / `check_is_admin` / `*_or_internal` 都走统一的 token 提取逻辑

这样可以保证：

- Web 端可以平滑切到 cookie
- 扩展不受影响，继续使用 Bearer token

### 2. Backend: Cookie Issuance and Logout

认证相关接口在保持现有 JSON 返回不变的前提下，增加 cookie 行为：

- `/api/auth/setup`：返回 `token`，同时 `Set-Cookie`
- `/api/auth/login`：返回 `token`，同时 `Set-Cookie`
- `/api/auth/password`：返回新 `token`，同时刷新 cookie
- 新增 `/api/auth/logout`：清理管理员 cookie

建议 cookie 属性：

- `HttpOnly = true`
- `Path = /`
- `SameSite = Lax`
- `Max-Age` 与 JWT 过期时间保持一致
- `Secure = false` 用于本地 `http://localhost`
- `Secure = true` 用于线上 `https`

cookie 名称使用固定且明确的管理员专用名称，例如 `lumina_admin_token`。

### 3. Frontend Web: Cookie-First Auth

Web 前端改为 cookie-first：

- axios 默认开启 `withCredentials`
- `AuthContext.checkAuth()` 不再以 `localStorage` 是否存在 token 决定是否调用 `/api/auth/verify`
- `login/setup/changePassword` 成功后不再依赖 `setToken()` 建立 Web 登录态，而是以后端写入 cookie 为准
- `logout()` 改为调用后端 logout 接口并清理本地兼容 token

兼容策略：

- 保留现有 `getToken/setToken/removeToken`
- Bearer token 继续可用，主要给扩展使用
- Web 端可在过渡期继续清理旧 `localStorage` token，但不再将其视作唯一登录依据

### 4. SSR: Forward Cookie to Backend

`frontend/lib/serverApi.ts` 需要把浏览器请求里的 cookie 透传到后端：

- `fetchServerJson` 从 `req.headers.cookie` 读取原始 cookie
- 如果存在，则在服务端 `fetch` 请求后端 API 时转发 `cookie` 请求头

这样后端在 SSR 时就能正确识别管理员身份，直接返回隐藏文章和管理员列表数据。

### 5. Remove admin_preview Flow

在 SSR 可识别管理员后，隐藏文章不再需要 URL 参数兜底：

- 删除 `frontend/lib/articlePreview.ts` 中 `admin_preview` 的构造与解析逻辑
- 删除 `article/[id].tsx` 中 `adminPreviewFallback` 逻辑
- 列表页、扩展跳转、创建后跳转、相关文章跳转都统一使用普通详情页地址

预期结果：

- `/article/:slug` 成为唯一详情页入口
- 管理员是否能看到隐藏文章只由真实登录态决定

### 6. Local Development Support

本地环境需满足：

- 前端 `localhost:3000`
- 后端 `localhost:8000`
- 前端 axios 使用 `withCredentials: true`
- 后端 CORS `allow_credentials = true`
- `ALLOWED_ORIGINS` 明确包含 `http://localhost:3000` 与 `http://127.0.0.1:3000`

由于 `localhost:3000` 与 `localhost:8000` 属于同站点不同源场景，`SameSite=Lax` 的 cookie 可随 `fetch/XHR` 在 `withCredentials` 下正常工作。

## Data Flow

### Login

1. 用户在 Web 登录页提交密码
2. 前端调用 `/api/auth/login`
3. 后端验证密码后返回 JSON，并写入管理员 cookie
4. 前端刷新鉴权状态，`/api/auth/verify` 通过 cookie 返回管理员身份

### SSR Article Page

1. 浏览器访问 `/article/:slug`
2. Next SSR 从请求头读取 cookie
3. `serverApi` 将 cookie 透传给后端 `/api/articles/:slug`
4. 后端识别管理员身份
5. 隐藏文章可直接 SSR 成功，不再依赖 `admin_preview`

### SSR List Page

1. 浏览器访问 `/list`
2. Next SSR 透传 cookie 给后端列表接口
3. 后端直接根据管理员身份返回可见性结果
4. 页面首屏即得到正确列表，无需 auth 解析后再补请求

## Migration Strategy

建议采用一次性切换、轻量兼容：

- 新版本上线后，Web 用户首次重新登录即可进入 cookie 模式
- 老的 `localStorage admin_token` 可保留一个版本周期作为兼容兜底
- 扩展继续沿用 Bearer token，无需迁移

这比设计“自动把 localStorage token 写回 cookie”的过渡逻辑更简单、更稳。

## Risks and Mitigations

### Risk: Local dev cookie not sent

原因：

- axios 未开启 `withCredentials`
- CORS 未允许 credentials

缓解：

- 前端统一在 axios 实例层设置 `withCredentials`
- 保持后端 `allow_credentials` 与 `ALLOWED_ORIGINS` 显式配置

### Risk: SSR fetch loses auth state

原因：

- `serverApi` 未透传 cookie

缓解：

- 将 cookie 透传封装在 `fetchServerJson`，避免页面级重复处理

### Risk: Web logout only clears local state

原因：

- cookie 未被后端删除，导致浏览器实际仍是登录状态

缓解：

- 新增后端 logout 接口，前端始终调用服务端清 cookie

### Risk: Extension accidentally depends on cookie

缓解：

- 后端继续优先支持 Bearer
- 本次实现不改扩展 `ApiClient` 的认证模式

## Testing Strategy

### Backend

- 单测覆盖 Bearer 有效、cookie 有效、两者都无效三种管理员鉴权路径
- 单测覆盖 login/setup/password 接口是否写 cookie
- 单测覆盖 logout 是否正确清 cookie

### Frontend

- 登录后刷新页面，管理员状态仍正确
- 本地 `3000 -> 8000` 下 `/list` 首屏能直接看到隐藏文章
- 直接访问隐藏文章详情不再需要 `admin_preview`
- 登出后刷新页面恢复访客态

### Extension

- 扩展授权与采集流程回归，确认 Bearer token 仍正常工作

## Files Expected to Change

Backend:

- `backend/auth.py`
- `backend/app/api/routers/auth_router.py`
- `backend/app/core/dependencies.py`
- 可能补充对应单测文件

Frontend:

- `frontend/lib/api.ts`
- `frontend/lib/serverApi.ts`
- `frontend/contexts/AuthContext.tsx`
- `frontend/pages/login.tsx`
- `frontend/pages/list.tsx`
- `frontend/pages/article/[id].tsx`
- `frontend/lib/articlePreview.ts`
- 对应前端回归测试

Extension:

- 仅在删除 `admin_preview` 跳转时改普通详情页 URL 生成

## Decision

采用“Web 用 HttpOnly cookie，扩展继续 Bearer”的混合认证方案。

这是当前收益最大、风险最可控、且能同时满足：

- 线上 SSR 管理员可见性
- 本地开发跨源调试
- 隐藏文章详情去掉 `admin_preview`
- 扩展无需重做授权链路
