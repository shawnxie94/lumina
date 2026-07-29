# Lumina Topic Bridge

本地常驻 HTTP 服务：从 Lumina 增量导出文章原料到 `llm_wiki` 项目，再把 concept/entity 编译结果写回 Lumina。

## 默认地址

- Bridge: `http://127.0.0.1:8787`
- llm_wiki health: `http://127.0.0.1:19828/health`



## One-click install (recommended)

No full repo clone required. Installs Bridge runtime into `~/.lumina/topic-bridge`:

```bash
curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash
```

Non-interactive example:

```bash
curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-topic-bridge.sh | bash -s -- \
  --lumina-url http://127.0.0.1:8000/backend \
  --internal-token dev-internal-token-change-me \
  --host 127.0.0.1 \
  --port 8787 \
  --bridge-token '' \
  --project-path "$HOME/.lumina/knowledge/Lumina-Knowledge" \
  --yes
```

Then manage with:

```bash
~/.lumina/topic-bridge/bin/lumina-bridge status
~/.lumina/topic-bridge/bin/lumina-bridge restart
~/.lumina/topic-bridge/bin/lumina-bridge reconfigure
```

Local checkout shortcut:

```bash
./scripts/install-topic-bridge.sh --yes --force
# or
./bridge/install.sh --yes --force  # wrapper -> scripts/install-topic-bridge.sh
```

## 快速启动（开发态 / 仓库内）

```bash
cd bridge
cp .env.example .env
# 编辑 LUMINA_BASE_URL / LUMINA_INTERNAL_TOKEN / LLM_WIKI_PROJECT_PATH

python3 -m topic_bridge
# 或
./run.sh
```

## API

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | Bridge 自身 |
| GET | `/status` | Bridge + llm_wiki + project + cursor |
| POST | `/sync` | 增量同步 + 写回 |

可选鉴权：设置 `BRIDGE_TOKEN` 后，请求需带 `Authorization: Bearer <token>`。


## Bootstrap（本机引导安装/启动）

浏览器无法静默安装桌面软件。本机用：

```bash
cd bridge
./bootstrap.sh setup
```

常用命令：

```bash
./bootstrap.sh start            # 启动 Bridge
./bootstrap.sh start-llm-wiki   # 启动已安装的 LLM Wiki
./bootstrap.sh init-project     # 初始化知识库目录
./bootstrap.sh status           # 查看状态
```

Bridge 额外 API：

| Method | Path | 说明 |
|---|---|---|
| GET | `/setup` | 本机安装/启动诊断与建议动作 |
| GET | `/doctor` | 与 `lumina doctor` 对齐的检查结果（设置页复用） |
| POST | `/setup/init-project` | 初始化知识库目录 |
| POST | `/setup/start-llm-wiki` | 启动已安装的 LLM Wiki |
| POST | `/setup/install-guidance` | 返回安装指引与命令 |

LLM Wiki 首次安装仍需官方 Releases；Bridge 可检测、启动、初始化项目并给出命令。


## CLI direction

本机入口将收敛为统一的 `lumina` CLI（配置远程地址/token、安装启动 bridge、管理可插拔 knowledge provider、触发同步与 OpenAPI 调用）。

当前 `install.sh` / `bootstrap.sh` / `lumina-bridge` 视为过渡实现；命令规范见：

- `docs/trd/lumina-cli-command-spec.md`
