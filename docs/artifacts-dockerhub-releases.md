# Docker Hub + GitHub Releases 制品发布说明

本项目已提供自动化发布工作流：
- Docker 镜像自动推送到 Docker Hub
- 浏览器扩展安装包自动上传到 GitHub Releases

## 1. 触发方式

工作流文件：`/.github/workflows/release-artifacts.yml`

### 方式 A：推送 tag（默认全量发布）

```bash
git tag v1.2.0
git push origin v1.2.0
```

### 方式 B：手动触发（可选发布范围）

在 GitHub Actions 页面点 `Run workflow`，输入：
- `target`: `all` / `backend` / `web` / `extension`
- `release_tag`: 手动触发必填（示例：`v1.2.0-rc.2`）

## 2. 自动产物

### Docker Hub 镜像

发布后会推送以下镜像：
- `docker.io/<namespace>/lumina-api:<tag>`
- `docker.io/<namespace>/lumina-worker:<tag>`
- `docker.io/<namespace>/lumina-web:<tag>`

同时会附带：
- `sha-<short_sha>` 标签
- `latest` 标签（仅稳定版标签，不含 `-`）

### GitHub Releases 资产

当 `target=all` 或 `target=extension` 时，Release 会上传：
- `lumina-extension-<tag>+<short_sha>.zip`
- `lumina-extension-<tag>+<short_sha>.zip.sha256`

## 3. 仓库设置要求

在仓库 `Settings > Secrets and variables > Actions` 中配置：

### Secrets（必填）
1. `DOCKERHUB_USERNAME`：Docker Hub 用户名
2. `DOCKERHUB_TOKEN`：Docker Hub Access Token（建议使用最小权限）

### Variables（可选）
1. `DOCKERHUB_NAMESPACE`：Docker Hub 命名空间（组织名/用户名）

> 若未配置 `DOCKERHUB_NAMESPACE`，工作流会默认使用 `DOCKERHUB_USERNAME` 作为命名空间。

并确认：

- `Settings > Actions > General > Workflow permissions` 为 `Read and write permissions`

## 4. VPS 拉取部署

已提供模板：`/docker-compose.dockerhub.yml.example`

建议流程：

1. 在 VPS 登录 Docker Hub
```bash
docker login -u <dockerhub_username>
```

2. 设置环境变量（示例）
```bash
export DOCKERHUB_NAMESPACE=<namespace>
export LUMINA_IMAGE_TAG=v1.2.0
export INTERNAL_API_TOKEN=<your_token>
```

3. 使用模板部署
```bash
cp docker-compose.dockerhub.yml.example docker-compose.yml
docker compose pull
docker compose up -d
```

## 5. 推荐版本策略

- 正式发布：`vX.Y.Z`
- 预发布：`vX.Y.Z-rc.1`
- 生产部署优先固定到 `vX.Y.Z` 或镜像 digest
