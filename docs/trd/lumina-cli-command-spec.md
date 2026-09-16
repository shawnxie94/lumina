---
id: trd-lumina-cli-command-spec
type: trd
status: implemented-p0
created_at: 2026-07-28
updated_at: 2026-07-28
sources:
  - conversation: lumina-cli-command-set-2026-07-28
related:
  - docs/trd/article-topic-bridge-integration.md
  - scripts/install-topic-bridge.sh
  - bridge/README.md
  - bridge/topic_bridge
  - frontend/pages/admin.tsx
assumptions:
  - Lumina Web remains the content workspace and settings surface; CLI is the local control plane.
  - Local knowledge compilation stays on the user machine; server/container runtime must not own desktop installs.
  - Knowledge providers are pluggable; llm_wiki is the first provider, not the only one.
  - Existing topic-bridge installer/manager can be absorbed into CLI without breaking current Bridge HTTP contracts.
  - First phase prioritizes install/config/doctor/bridge/knowledge/sync/api over full remote content admin parity.
---

# TRD / Spec: Lumina CLI 命令规范

## 1. Background and Goals

### 背景

Lumina 主题解析已形成双端架构：

- **Lumina Web/API**：内容 SoT、展示、设置、主题消费
- **本机 Bridge**：连接远程 Lumina 与本地知识编译引擎
- **Knowledge Provider**：当前为 `llm_wiki`，负责编译/沉淀

当前本机入口仍偏碎片化：

- 设置页只能检测与引导
- `install-topic-bridge.sh` / `lumina-bridge` / `bootstrap.sh` 多套入口
- 命令与文案容易绑死 `llm_wiki`

需要一个统一、可扩展的本机 CLI，作为长期控制面。

### 目标

1. 用户只安装一个入口：`lumina`
2. 通过 CLI 配置远程 Lumina 地址、token、profile
3. 通过 CLI 安装/启动/诊断本机 Bridge 与知识库 provider
4. 通过 CLI 触发同步，并调用 Lumina OpenAPI
5. 命令树对 knowledge provider **可插拔**，避免写死 `llm_wiki`

### 非目标

- 不把 CLI 做成完整桌面 App / GUI
- 不在 CLI 内重写知识编译引擎
- 不让 Docker 中的 Lumina server 代管用户本机安装
- 第一期不追求覆盖全部 Admin 后台能力
- 第一期不实现任意第三方 provider，只预留接口并以 `llm_wiki` 落地

---

## 2. Product Positioning

| 组件 | 职责 |
|---|---|
| Lumina Web | 阅读、运营、主题展示、设置开关与状态 |
| Lumina API | 远程数据与权限边界 |
| Lumina CLI | 本机控制面：配置、安装、启动、诊断、同步、API 调用 |
| Bridge | 本机通用连接器（与具体知识引擎解耦） |
| Knowledge Provider | 可替换的本地知识编译/存储实现 |

一句话：

> **Web 负责看和配；CLI 负责连、装、启、同步、排障。**

---

## 3. Design Principles

1. **远程环境与本机 runtime 分离**
   - `profile` = 连哪套 Lumina
   - `project` = 哪个本地知识库实例
   - `provider` = 用什么引擎

2. **Provider 可插拔**
   - 用户命令使用 `knowledge` / `sync`
   - 不把 `llm_wiki` 做成顶层必经命名空间

3. **稳定语义优先**
   - 日常命令应长期稳定：`doctor` / `up` / `sync` / `status`

4. **组合优于大一统**
   - 高频能力一等公民子命令
   - 低频/高级能力走 `api` / `openapi`

5. **默认安全**
   - 写操作可确认
   - token 默认脱敏
   - `--yes` 显式跳过确认

6. **对脚本友好**
   - 全命令支持 `--output json`
   - 非 0 退出码表示失败

---

## 4. CLI Shape

```bash
lumina [global flags] <group> <command> [args] [flags]
```

### Global flags

| Flag | 说明 |
|---|---|
| `--profile <name>` | 选择 profile，默认 `default` |
| `--base-url <url>` | 覆盖远程 Lumina base url |
| `--token <token>` | 覆盖 auth token |
| `--output table\|json\|yaml` | 输出格式，默认 `table` |
| `--yes` | 跳过确认 |
| `--verbose` | 详细日志 |
| `--quiet` | 仅必要输出 |
| `--config <path>` | 指定配置文件 |

### 安装后入口

```bash
lumina version
lumina help
lumina completion bash|zsh|fish
```

### 建议安装位置

- 二进制：`~/.lumina/bin/lumina` 或 `/usr/local/bin/lumina`
- 配置：`~/.lumina/config.yaml`
- 数据/runtime：`~/.lumina/`
  - `bridge/`
  - `providers/`
  - `logs/`
  - `profiles/`

---

## 5. Config Model

### 5.1 概念

| 概念 | 含义 | 示例 |
|---|---|---|
| Profile | 远程 Lumina 环境 | `local` / `prod` |
| Project | 本地知识库实例 | `main` / `research` |
| Provider | 知识引擎适配器 | `llm_wiki` / future |
| Bridge | 本机连接器进程 | `127.0.0.1:8787` |

### 5.2 配置文件草案

```yaml
active_profile: default
active_project: main

profiles:
  default:
    lumina:
      base_url: http://127.0.0.1:8000/backend
      token: ""                 # API/internal token，按权限模型区分
      timeout_sec: 30
    bridge:
      host: 127.0.0.1
      port: 8787
      token: ""
      autostart: true
    defaults:
      output: table
      sync_mode: incremental

projects:
  main:
    provider: llm_wiki
    path: ~/.lumina/knowledge/Lumina-Knowledge
    name: Lumina-Knowledge
    options: {}               # provider 专有配置
    linked_profile: default

providers:
  llm_wiki:
    enabled: true
    install:
      strategy: official_release
    runtime:
      api_url: http://127.0.0.1:19828
    options: {}
```

### 5.3 关键约束

- `knowledge.*` 命令读写 **active project**
- `sync` 使用 **active profile + active project**
- provider 专有字段只能进 `projects[].options` 或 `providers.<name>.options`
- 核心命令 flags 不出现 `--llm-wiki-*` 这种引擎绑死命名

---

## 6. Provider Extension Model

### 6.1 Provider Adapter 接口（逻辑）

每个 provider 至少实现：

```text
name()
describe()
doctor()
install()
update()
uninstall()          # optional
init_project(path, options)
start()
stop()
status()
logs()               # optional
open()               # optional, open app/UI/dir
prepare_sync(ctx)    # optional pre-hook
```

Bridge 侧继续通过稳定 HTTP/文件契约与 provider 协作；CLI 不直接依赖某一桌面 App 内部实现。

### 6.2 当前与未来

| Provider | 第一期 | 说明 |
|---|---|---|
| `llm_wiki` | 支持 | 官方 app/API + project skeleton |
| `obsidian` | 预留 | 未来 vault/adapter |
| `logseq` | 预留 | 未来 |
| `filesystem` | 预留 | 纯目录同步/导出 |
| `custom` | 预留 | 用户自定义 adapter |

### 6.3 命令层映射

用户始终使用：

```bash
lumina knowledge install --provider llm_wiki
lumina knowledge start
lumina sync
```

而不是：

```bash
lumina llm-wiki install
lumina llm-wiki sync
```

---

## 7. Command Catalog

说明：

- **P0**：第一期必须
- **P1**：完善体验
- **P2**：扩展/高级

---

### 7.1 Top-level

| 命令 | 阶段 | 说明 |
|---|---|---|
| `lumina version` | P0 | CLI / schema / bridge 兼容版本 |
| `lumina help [command]` | P0 | 帮助 |
| `lumina init` | P0 | 初始化 config、默认 profile/project |
| `lumina doctor` | P0 | 综合诊断 |
| `lumina status` | P0 | 精简状态 |
| `lumina up` | P0 | 启动 bridge + knowledge runtime |
| `lumina down` | P0 | 停止本机 runtime |
| `lumina ps` | P1 | 列出本机相关进程/服务 |
| `lumina update` | P0 | 更新 CLI/bridge/provider |
| `lumina completion <shell>` | P1 | 补全 |

#### `lumina init`

```bash
lumina init
lumina init --base-url <url> --token <token>
lumina init --provider llm_wiki --path ~/.lumina/knowledge/Lumina-Knowledge
lumina init --non-interactive
```

行为：

1. 创建 `~/.lumina/config.yaml`（若不存在）
2. 写入默认 profile/project
3. 可选执行 `doctor`
4. 打印 next steps

#### `lumina doctor`

```bash
lumina doctor
lumina doctor --fix
lumina doctor --output json
```

检查：

- 配置合法性
- 远程 Lumina 连通与鉴权
- Bridge 安装/端口/健康
- active provider 安装/运行/项目目录
- 最近 sync 状态
- 修复建议（可直接复制的下一步命令）

#### `lumina up` / `down`

```bash
lumina up
lumina up --no-knowledge
lumina down
```

等价于编排：

- start bridge
- start knowledge provider（若需要）

---

### 7.2 Profile / Config / Auth

#### `lumina profile`（P0）

```bash
lumina profile list
lumina profile show [name]
lumina profile use <name>
lumina profile create <name>
lumina profile delete <name>
lumina profile export <name> > profile.yaml
lumina profile import <file>
```

#### `lumina config`（P0）

```bash
lumina config path
lumina config get [key]
lumina config set <key> <value>
lumina config unset <key>
lumina config edit
lumina config validate
```

示例：

```bash
lumina config set lumina.base_url http://127.0.0.1:8000/backend
lumina config set lumina.token dev-internal-token-change-me
lumina config set bridge.port 8787
lumina config set knowledge.provider llm_wiki
```

> 实现上 `knowledge.provider` 可映射到 active project 的 provider 字段。

#### `lumina auth`（P0/P1）

```bash
lumina auth status                 # P0
lumina auth token set              # P0
lumina auth token show             # P0，默认脱敏
lumina auth login                  # P1，若后续有交互登录
lumina auth logout                 # P1
lumina whoami                      # P0
```

`whoami` 输出：

- profile
- base_url
- auth 是否配置
- 权限摘要（若 API 可探测）

---

### 7.3 Bridge

Bridge 是**通用本机连接器**，不绑定单一知识库品牌。

#### 命令（P0）

```bash
lumina bridge install
lumina bridge update
lumina bridge uninstall            # P1

lumina bridge start
lumina bridge stop
lumina bridge restart
lumina bridge status
lumina bridge logs [--follow]

lumina bridge doctor
lumina bridge serve                # 前台运行，开发用
lumina bridge open                 # P1，打开本地 status/文档
```

#### 配置

```bash
lumina bridge config show
lumina bridge config set host 127.0.0.1
lumina bridge config set port 8787
lumina bridge config set token <token>
```

#### 兼容

可继续保留底层：

- `~/.lumina/topic-bridge`
- Bridge HTTP：`/health` `/status` `/setup` `/sync`

但用户默认只接触 `lumina bridge ...`。

---

### 7.4 Knowledge（核心扩展点）

#### Provider 管理

```bash
lumina knowledge providers                 # P0
lumina knowledge provider show <name>      # P0
lumina knowledge provider install <name>   # P0
lumina knowledge provider update <name>    # P1
lumina knowledge provider uninstall <name> # P2
lumina knowledge provider doctor <name>    # P0
```

#### Active knowledge project

```bash
lumina knowledge status                    # P0
lumina knowledge init                      # P0
lumina knowledge init --provider llm_wiki --path <path>
lumina knowledge use <provider>            # P0
lumina knowledge set-path <path>           # P0
lumina knowledge open                      # P1
lumina knowledge doctor                    # P0
```

#### Runtime

```bash
lumina knowledge start                     # P0
lumina knowledge stop                      # P0
lumina knowledge restart                   # P0
lumina knowledge logs [--follow]           # P1
```

#### 说明

- `knowledge start` 对 `llm_wiki` 表示启动其本地 API/App
- 若 provider 只能官方安装，`provider install` 负责下载/引导，不假装完全静默成功
- `options` 用于 provider 差异，不污染全局命令

---

### 7.5 Project（多本地知识库，P1）

当用户需要多个知识库实例时：

```bash
lumina project list
lumina project show [name]
lumina project create <name> --provider llm_wiki --path <path>
lumina project use <name>
lumina project delete <name>
lumina project link --profile <name>
lumina project unlink
```

第一期可只内置单 project（`main`），但配置模型按多 project 设计。

---

### 7.6 Sync

同步是一等公民能力。

```bash
lumina sync                            # P0，默认增量
lumina sync run                        # P0，同 sync
lumina sync status                     # P0
lumina sync history                    # P1
lumina sync logs                       # P1
lumina sync explain                    # P1，dry 说明

lumina sync incremental                # P0
lumina sync full                       # P0
lumina sync articles                   # P1，仅导出原料
lumina sync topics                     # P1，仅写回主题
lumina sync article <article_id>       # P0
lumina sync retry                      # P1
```

常用 flags：

```bash
--since <iso8601>
--article-id <id>
--dry-run
--force
--provider <name>
--project <name>
--profile <name>
```

默认路径：

```text
CLI -> Bridge /sync -> provider compile/export -> Lumina writeback API
```

---

### 7.7 Remote content commands

对 OpenAPI 的产品化封装。第一期做只读主路径，后续再扩展写操作。

#### `articles`（P0/P1）

```bash
lumina articles list                   # P0
lumina articles get <id>               # P0
lumina articles search <query>         # P1
lumina articles export                 # P1
lumina articles open <id>              # P1
lumina articles show-topics <id>       # P1
```

#### `topics`（P0/P1）

```bash
lumina topics list                     # P0
lumina topics get <key>                # P0
lumina topics search <query>           # P1
lumina topics articles <key>           # P1
lumina topics export <key>             # P1
lumina topics open <key>               # P1
```

#### `tags` / `columns`（P1/P2）

```bash
lumina tags list
lumina tags search <q>
lumina columns list
lumina columns get <slug>
```

---

### 7.8 Raw API / OpenAPI

```bash
lumina api get <path>                  # P0
lumina api post <path>                 # P0
lumina api put <path>                  # P0
lumina api patch <path>                # P1
lumina api delete <path>               # P1
lumina api call <METHOD> <path>        # P0

lumina openapi fetch                   # P1
lumina openapi paths                   # P1
lumina openapi show <operation>        # P1
```

示例：

```bash
lumina api get /api/topics
lumina api get /api/settings/topics
lumina api post /api/topics/compile-results --body-file ./payload.json
```

flags：

```bash
--header K:V
--query k=v
--body '{"a":1}'
--body-file ./x.json
--accept json
```

---

### 7.8.1 Bridge runtime modes (P0.5)

```bash
lumina bridge start                # default: OS supervised service
lumina bridge start --no-service   # explicit bare nohup
lumina bridge stop
lumina bridge stop --disable-service
lumina bridge restart
lumina bridge status               # includes mode + service backend details
```

Behavior:

- Default start installs/uses:
  - macOS LaunchAgent `com.lumina.bridge` (`KeepAlive`)
  - Linux systemd `--user` `lumina-bridge.service` (`Restart=always`)
- `--no-service` is the only intentional nohup path
- `status.mode` is `service | nohup | stopped`
- Does not supervise knowledge provider processes
- Deprecated aliases (hidden): `install-service` / `uninstall-service` / `service-status`

---

### 7.9 Services / Runtime orchestration

```bash
lumina services list                   # P1
lumina services status                 # P1
lumina services start all|bridge|knowledge
lumina services stop all|bridge|knowledge
lumina services restart all
```

与 `up`/`down` 的关系：

- `up`/`down`：用户友好短命令
- `services`：更显式的运维命令

---

### 7.10 Install / Update

```bash
lumina install                         # P0，安装 CLI 自身依赖的本机组件
lumina install bridge                  # P0
lumina install knowledge --provider <name>  # P0
lumina install all                     # P1

lumina update                          # P0
lumina update cli                      # P0
lumina update bridge                   # P0
lumina update knowledge [--provider <name>] # P1
```

`install` 与 `provider install` 可共用 adapter，不复制逻辑。

---

### 7.11 Logs / Debug

```bash
lumina logs                            # P1，汇总
lumina logs bridge [--follow]          # P0
lumina logs knowledge [--follow]       # P1
lumina logs sync                       # P1

lumina debug env                       # P1
lumina debug probe remote              # P1
lumina debug probe bridge              # P1
lumina debug probe knowledge           # P1
lumina debug bundle                    # P2，脱敏诊断包
```

---

### 7.12 Plugin / Provider extension（P2）

```bash
lumina provider list
lumina provider add <name> --from <source>
lumina provider remove <name>
lumina plugin list
lumina plugin install <name>
```

第一期可不暴露，但内部按 adapter 注册表实现。

---

## 8. Everyday Command UX

大多数用户只需要记住：

```bash
lumina init
lumina auth token set
lumina doctor
lumina up
lumina sync
lumina topics list
lumina articles list
lumina api get /api/...
```

### 推荐成功路径

```bash
# 1) 安装 CLI 后初始化
lumina init --base-url http://127.0.0.1:8000/backend --token <token>

# 2) 安装并启动本机组件
lumina install bridge
lumina install knowledge --provider llm_wiki
lumina up

# 3) 诊断
lumina doctor

# 4) 同步
lumina sync

# 5) 查看
lumina topics list
```

### 失败时的 next-step 风格

```text
Bridge offline
Next:
  lumina bridge start
  lumina doctor
```

---

## 9. Output & Exit Code Contract

### Output

- 默认 `table`（人类可读）
- `--output json` 适合脚本
- 错误信息进 stderr；机器可读错误可用 JSON：

```json
{
  "ok": false,
  "error": {
    "code": "bridge_offline",
    "message": "Bridge is not reachable at http://127.0.0.1:8787",
    "hint": "Run `lumina bridge start`"
  }
}
```

### Exit codes

| Code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用失败 |
| 2 | 参数/配置错误 |
| 3 | 远程鉴权失败 |
| 4 | 本机依赖缺失（bridge/provider） |
| 5 | 同步失败 |
| 6 | 部分成功（可选，慎用） |

---

## 10. Mapping to Current Implementation

| 现有能力 | CLI 归宿 |
|---|---|
| `scripts/install-topic-bridge.sh` | `lumina install bridge` / `lumina init` |
| `~/.lumina/topic-bridge/bin/lumina-bridge` | `lumina bridge *` |
| Bridge `/status` `/setup` `/sync` | `bridge status` / `doctor` / `sync` |
| 设置页“本机安装”弹窗 | 复制 `curl | bash` 安装 CLI，或 `lumina doctor` |
| `llm_wiki` 健康检查与启动 | `knowledge provider/adapter` |
| 主题设置中的 project_path / bridge url | profile + project config |

### 迁移策略

1. **Phase A**：CLI 薄封装现有 bridge installer/manager  
2. **Phase B**：引入 provider 接口，把 `llm_wiki` 收成 adapter  
3. **Phase C**：补齐 articles/topics/api 只读命令  
4. **Phase D**：设置页改为“依赖 CLI”的轻量状态与引导  

兼容要求：

- 现有 Bridge HTTP 契约不破
- 现有 `~/.lumina/topic-bridge` 可被 CLI 接管
- 旧脚本可暂时保留为兼容层，文档主推 `lumina`

---

## 11. Web Settings Collaboration

设置页（主题解析）保留：

- 启用开关
- Bridge / knowledge / project / sync 状态
- 远程可配项（若仍需）

设置页不再主做：

- 复杂本机安装向导
- 多段命令教学

改为：

```text
未检测到本机 CLI/Bridge
→ 复制安装命令
→ 或打开 CLI 文档
→ 用户完成后点“重新检测”
```

推荐展示命令：

```bash
curl -fsSL https://raw.githubusercontent.com/shawnxie94/lumina/main/scripts/install-lumina-cli.sh | bash
lumina init
lumina doctor
```

---

## 12. Security Notes

1. token 存储在用户本机 config，权限应限制为用户可读
2. `auth token show` / `config get` 默认脱敏
3. `debug bundle` 必须剥离 secret
4. Bridge token 与 Lumina token 分离
5. 默认 Bridge bind `127.0.0.1`；若 bind `0.0.0.0` 需显式警告
6. 写操作（uninstall/full sync/delete）支持确认

---

## 13. P0 Implementation Scope

### P0 命令冻结列表

```bash
lumina version
lumina init
lumina doctor
lumina status
lumina up
lumina down

lumina profile list|show|use|create|delete
lumina config path|get|set|unset|validate
lumina auth status|token set|token show
lumina whoami

lumina bridge install|update|start|stop|restart|status|logs|doctor|serve
lumina knowledge providers
lumina knowledge provider show|install|doctor
lumina knowledge status|init|use|set-path|start|stop|restart|doctor

lumina sync
lumina sync status
lumina sync full
lumina sync incremental
lumina sync article <id>

lumina articles list|get
lumina topics list|get

lumina api get|post|put|call
lumina logs bridge
lumina update
lumina update cli
lumina update bridge
```

### P0 验收标准

1. 不 clone 整仓，仅装 CLI 即可完成 bridge 安装与启动
2. `lumina doctor` 能明确指出 remote / bridge / provider / project 哪一层失败
3. `lumina sync` 能走通当前 topic-bridge 写回链路
4. `knowledge` 命令可指定 `--provider`，默认读取 config，不把 `llm_wiki` 写死进命令名
5. `api get/post` 可调用现有 Lumina backend API
6. 设置页可引导到 CLI 安装，不再依赖仓库内 `cd bridge`

---

## 14. Open Questions

1. 鉴权最终以 `INTERNAL_API_TOKEN`、Admin session token，还是未来独立 CLI token 为主？
2. `lumina up` 是否默认尝试启动 provider UI（如 LLM Wiki app），还是仅保证 API 健康？
3. 多 project 是否第一期就暴露，还是只做配置预留？
4. Windows 是否与 macOS/Linux 同期支持，还是 P1？
5. provider 分发方式：内置 adapter only，还是支持外部 plugin 包？

---

## 15. Recommended Next Docs

1. `docs/trd/lumina-cli-architecture.md`  
   - 目录结构、config schema、provider interface、与 bridge 进程模型
2. `docs/trd/lumina-cli-p0-execution-plan.md`  
   - 从现有 installer/bridge 收编到 `lumina` 的实现任务（已产出 draft）
3. 设置页改造补丁说明  
   - 主题解析页如何改为 CLI 依赖引导

---

## 16. Summary

Lumina CLI 的命令集应围绕四层展开：

1. **连接远程**：`profile` / `config` / `auth` / `api`
2. **管理本机连接器**：`bridge`
3. **管理可插拔知识引擎**：`knowledge` + provider adapters
4. **执行同步与诊断**：`sync` / `doctor` / `logs`

其中：

- `llm_wiki` 只是第一个 knowledge provider
- 用户日常不需要学习引擎专有命令树
- 现有 topic-bridge 安装与 HTTP 能力可作为 P0 内核复用

这版规范用于约束后续 CLI 实现与设置页协作方式，避免再次出现“页面假安装 / 脚本入口分裂 / 引擎名写死”的问题。

### Follow-ups landed

- `lumina completion bash|zsh|fish`
- second provider skeleton: `generic_fs`
- Bridge `GET /doctor` + settings page recheck aligned with `lumina doctor`
