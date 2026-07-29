---
id: plan-lumina-cli-p0
type: execution_plan
status: implemented-p0
created_at: 2026-07-28
updated_at: 2026-07-28
sources:
  - docs/trd/lumina-cli-command-spec.md
  - docs/trd/article-topic-bridge-integration.md
  - conversation: lumina-cli-p0-plan-2026-07-28
related:
  - docs/trd/lumina-cli-command-spec.md
  - scripts/install-topic-bridge.sh
  - bridge/topic_bridge
  - bridge/install.sh
  - frontend/pages/admin.tsx
assumptions:
  - P0 reuses existing topic-bridge runtime and HTTP contracts instead of rewriting sync.
  - llm_wiki is the first knowledge provider adapter only; command names stay provider-agnostic.
  - P0 targets macOS/Linux first; Windows is explicit non-goal unless pulled forward.
  - Auth for P0 uses configurable token against Lumina backend (INTERNAL/API token style), not a new OAuth product.
  - Settings page becomes CLI-guided; it does not re-implement local install orchestration.
---

# Execution Plan: Lumina CLI P0

## 1. Goal

把现有本机安装/Bridge/同步能力收编为统一 `lumina` CLI，完成命令规范中的 **P0 冻结列表**，并让主题解析设置页改为依赖 CLI 的轻量引导。

Done 的定义：

1. 用户不 clone 整仓，只装 CLI 就能配置远程 Lumina、安装启动 Bridge、初始化 knowledge project、执行 sync。
2. `lumina doctor` 能分层指出 remote / bridge / provider / project 故障。
3. `knowledge` 命令以 provider 抽象落地，`llm_wiki` 仅作为第一个 adapter。
4. 现有 Bridge HTTP 契约与写回链路不被破坏。
5. 设置页不再引导 `cd bridge`，改为 CLI 安装/诊断命令。

Source of truth：

- 命令与范围：`docs/trd/lumina-cli-command-spec.md`
- 主题同步既有链路：`docs/trd/article-topic-bridge-integration.md`

---

## 2. P0 Scope Freeze

### In scope

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

### Explicit out of scope (P0)

- Windows 完整支持
- 多 project UX 全量暴露（配置可预留，不做复杂切换产品化）
- `openapi fetch/codegen`、plugin 市场
- 设置页复杂安装向导回流
- 重写 llm_wiki / 重写 Bridge sync 算法
- Admin 全量写操作封装（delete/update article 等）

### P0 决策（执行期先按此推进）

| 问题 | P0 决策 |
|---|---|
| 鉴权 | 配置 token（兼容当前 internal/API token）；不新做 OAuth |
| `lumina up` | 启动 Bridge；provider 以“API 健康”为目标，能启动 app 则启动，否则给安装/启动提示 |
| 多 project | 配置模型预留，CLI 默认单 active project |
| Provider 分发 | 仅内置 adapter（`llm_wiki`） |
| 实现语言 | Python 3.9+（与现有 bridge 一致，便于复用） |

---

## 3. Current Assets to Reuse

| 现有资产 | P0 用法 |
|---|---|
| `scripts/install-topic-bridge.sh` | 收编为 `lumina bridge install` / `lumina install bridge` 内核 |
| `~/.lumina/topic-bridge` + `bin/lumina-bridge` | 作为 bridge runtime 目录与兼容层 |
| `bridge/topic_bridge/*` | 继续作为 bridge 进程实现 |
| Bridge `/health` `/status` `/setup` `/sync` | CLI status/doctor/sync 的本机协议 |
| `bootstrap.ensure_project` / llm_wiki detect-start | `knowledge` adapter 初值 |
| 设置页主题解析 | 改为 CLI 引导文案与命令复制 |

原则：**先包装，再收敛；先跑通，再清理旧入口。**

---

## 4. Target Mini Architecture (P0)

```text
packages/lumina-cli/   (or cli/)
  lumina_cli/
    __main__.py
    app.py                 # typer/click entry
    config.py              # profile/project schema
    output.py              # table/json
    http.py                # remote API client
    bridge_runtime.py      # install/start/stop/logs against ~/.lumina/topic-bridge
    knowledge/
      base.py              # provider protocol
      registry.py
      llm_wiki.py          # first adapter
    cmds/
      init.py doctor.py status.py
      profile.py config.py auth.py
      bridge.py knowledge.py sync.py
      articles.py topics.py api.py
      update.py logs.py
scripts/install-lumina-cli.sh
```

Home layout：

```text
~/.lumina/
  config.yaml
  bin/lumina
  topic-bridge/            # existing bridge runtime (managed)
  logs/
  providers/llm_wiki/      # optional metadata only in P0
```

---

## 5. Implementation DAG

```text
N1 Config/Auth contract
   └─ N2 CLI skeleton + output/exit codes
        ├─ N3 Bridge runtime wrapper (install/start/stop/status/logs)
        │    └─ N6 up/down/status/doctor(local parts)
        ├─ N4 Knowledge provider interface + llm_wiki adapter
        │    └─ N6 doctor(provider/project parts)
        ├─ N5 Remote API client (auth, articles, topics, api call)
        │    └─ N7 sync commands (via bridge + remote status)
        └─ N8 install-lumina-cli.sh + update paths
             └─ N9 Settings page CLI guidance
                  └─ N10 E2E verification + docs/compat cleanup
```

### Critical path

`N1 → N2 → N3 → N4 → N6 → N7 → N8 → N10`

`N5` 可与 `N3/N4` 并行。  
`N9` 依赖 `N8` 的最终安装命令文案稳定。

### Risk-first nodes

| Node | 风险 | 为何先做/早验 |
|---|---|---|
| N3 | 现有 bridge 进程生命周期不稳、端口占用、安装目录兼容 | 无 bridge 则 CLI 无价值 |
| N4 | llm_wiki 只能引导安装，不能假成功 | doctor/up 体验核心 |
| N7 | sync 是端到端闭环 | 验收关键路径 |
| N1 | profile/project/provider 模型若漂，后续全改 | 合同先行 |

### Single-writer boundaries

| 区域 | 单写者 |
|---|---|
| config schema / `config.yaml` 字段 | N1 owner |
| CLI 命令树与 exit code | N2 owner |
| bridge runtime 目录约定 | N3 owner |
| provider interface | N4 owner |
| settings page copy/commands | N9 owner |

---

## 6. Work Packages

### N1 — Config / Profile / Auth contract

**目标**：冻结 P0 配置模型与读写 API。

**任务**

1. 定义 `Config` / `Profile` / `Project` 数据结构
2. 实现：
   - load/save `~/.lumina/config.yaml`
   - 默认 active profile/project
   - token 脱敏显示
3. 实现命令：
   - `profile list|show|use|create|delete`
   - `config path|get|set|unset|validate`
   - `auth status|token set|token show`
   - `whoami`（先基于 config，不强制远程）

**依赖**：无  
**验证**

```bash
lumina init --non-interactive
lumina config set lumina.base_url http://127.0.0.1:8000/backend
lumina auth token set --token dev-internal-token-change-me
lumina config get lumina.base_url
lumina whoami --output json
```

**验收**

- 重复 `init` 幂等
- token 不会明文出现在 `table` 默认输出
- `validate` 能抓到缺 base_url / 非法 port

---

### N2 — CLI skeleton

**目标**：统一入口、全局 flags、输出与退��码。

**任务**

1. 选定框架：建议 `typer`（或 click）
2. 全局 flags：`--profile --base-url --token --output --yes --verbose --quiet`
3. `version` / `help`
4. 错误类型映射到 exit code（2 参数、3 鉴权、4 本机依赖、5 sync）
5. `--output json` 公共 renderer

**依赖**：N1（可并行起步，但 flags 读取 config 需 N1）  
**验证**

```bash
lumina version
lumina help
lumina doctor --help
python -m lumina_cli ...  # dev mode
```

**验收**

- 未知命令非 0
- json 输出稳定可解析

---

### N3 — Bridge runtime wrapper

**目标**：把现有 installer/manager 收成 `lumina bridge *`。

**任务**

1. 复用/迁移：
   - `scripts/install-topic-bridge.sh` 的下载/本地 monorepo 拷贝逻辑
   - `lumina-bridge` start/stop/status/logs
2. 命令：
   - `bridge install|update|start|stop|restart|status|logs|doctor|serve`
3. runtime root 固定：`~/.lumina/topic-bridge`（可配置覆盖）
4. 兼容旧 `lumina-bridge` 二进制：可保留为 shim 或生成同等入口
5. 强化进程保活与日志（已知 bridge 易早退时，至少 fail-fast + 明确 log 路径）

**依赖**：N1/N2  
**验证**

```bash
lumina bridge install --yes
lumina bridge start
curl -fsS http://127.0.0.1:8787/health
lumina bridge status --output json
lumina bridge logs | tail
lumina bridge stop
```

**验收**

- 不需要 git clone 整仓
- 二次 install 可 `--force` 更新 package
- status 能显示 online/offline 与 project path

**风险缓解**

- 先写 `bridge doctor` 检测 port conflict / stale pid / missing package
- start 失败必须指向 log 文件

---

### N4 — Knowledge provider interface + llm_wiki adapter

**目标**：命令不绑死引擎名，但 P0 真正支持 `llm_wiki`。

**任务**

1. 定义 Provider protocol：
   - `name/describe/doctor/install/init_project/start/stop/status`
2. registry：`providers()` / `get(name)`
3. 实现 `llm_wiki` adapter：
   - detect app/cli
   - install guidance / best-effort official download open
   - start app on macOS
   - health against `api_url`
   - init project skeleton（复用 bridge bootstrap ensure_project 逻辑，可抽共享库或调用 bridge setup API）
4. 命令：
   - `knowledge providers`
   - `knowledge provider show|install|doctor`
   - `knowledge status|init|use|set-path|start|stop|restart|doctor`

**依赖**：N1/N2；init_project 可依赖 N3（若走 bridge `/setup/init-project`）  
**验证**

```bash
lumina knowledge providers
lumina knowledge use llm_wiki
lumina knowledge set-path ~/.lumina/knowledge/Lumina-Knowledge
lumina knowledge init
lumina knowledge provider doctor llm_wiki
lumina knowledge start
lumina knowledge status --output json
```

**验收**

- 无任何必选命令路径写死 `lumina llm-wiki ...`
- provider 未安装时 `install/doctor` 给出可执行 next step，而不是空失败
- `use` 只改 config，不隐式切换其他 profile

---

### N5 — Remote API client

**目标**：为 articles/topics/api/whoami-remote/doctor-remote 提供统一 HTTP 层。

**任务**

1. client：base_url 规范化（确保 `/backend` 语义清晰）
2. header：token 注入
3. 命令：
   - `api get|post|put|call`
   - `articles list|get`
   - `topics list|get`
4. 错误分类：401/403 → exit 3；连接失败与 5xx 可区分信息

**依赖**：N1/N2  
**验证**

```bash
lumina api get /api/settings/topics
lumina articles list --page 1 --size 5
lumina topics list --page 1 --size 5
lumina articles get <id>
lumina topics get <key>
```

**验收**

- 与当前 backend 路径兼容
- json 模式下保留原始关键字段
- token 缺失时错误可理解

---

### N6 — doctor / status / up / down

**目标**：用户日常最短路径。

**任务**

1. `status`：remote（可选）、bridge、provider、project、last sync 摘要
2. `doctor`：逐项 check + next steps
3. `up`：bridge start + knowledge start（best effort）
4. `down`：stop knowledge（best effort）+ bridge stop

**依赖**：N3/N4/N5（remote check 需要 N5，可降级）  
**验证**

```bash
lumina down || true
lumina up
lumina status
lumina doctor --fix
```

**验收**

- doctor 在 bridge 挂掉时仍能报告 provider/config 其他层
- up 在 provider 未安装时不 dual-fail 成不可读错误；应 bridge online + provider action required

---

### N7 — sync commands

**目标**：打通 P0 关键闭环。

**任务**

1. `sync` / `sync incremental` / `sync full` / `sync article <id>` / `sync status`
2. 实现策略：
   - 优先调用本机 Bridge `POST /sync`（复用现有能力）
   - `sync status` 读 remote settings topics + bridge cursor（若可得）
3. `--dry-run` 可 P0 只做 explain 子集或先不支持；若不做，文档标明
4. 失败映射 exit code 5

**依赖**：N3 必须；N5 用于 status/writeback 观测  
**验证**

```bash
lumina bridge start
lumina knowledge start || true
lumina sync
lumina sync status --output json
# optional if supported by bridge:
lumina sync article <id>
```

**验收**

- 至少一条文章可导出/写回或明确显示 no-op reason
- Bridge offline 时 hint `lumina bridge start`

**注意**

- P0 不重做 compile 语义；provider 编译仍可由 llm_wiki 侧完成/半自动
- `full` 若 bridge 尚无真正 full 参数，需在实现里定义等价行为或暂时映射并文档化限制

---

### N8 — install-lumina-cli.sh + update

**目标**：单入口安装 CLI 本身。

**任务**

1. 新增 `scripts/install-lumina-cli.sh`
   - 安装 CLI 到 `~/.lumina/bin`
   - PATH 提示
   - 可选顺便 `bridge install`
2. `lumina update cli|bridge`
3. 文档主推命令改为该脚本
4. 保留 `install-topic-bridge.sh` 作为兼容，但标注 deprecated by CLI

**依赖**：N2/N3 基本可用  
**验证**

```bash
./scripts/install-lumina-cli.sh --yes
lumina version
lumina update bridge
```

**验收**

- 干净机器路径：装 CLI → init → bridge install → up
- 不要求 monorepo checkout（允许从 GitHub codeload 拉 cli/bridge 子集）

---

### N9 — Settings page CLI guidance

**目标**：主题解析页与 CLI 对齐。

**任务**

1. 「本机安装」弹窗文案改为 CLI 优先：
   - `curl .../install-lumina-cli.sh | bash`
   - `lumina init`
   - `lumina doctor`
   - `lumina up`
2. 去掉/弱化仓库路径命令（`cd bridge && ...`）
3. 状态区保持精简；可显示“检测到 Bridge”但不假装 Web 能安装
4. i18n 同步

**依赖**：N8 安装命令最终 URL/文案  
**验证**

- 手动打开 `/admin/settings/topics`
- 弹窗命令可复制
- 与 README/TRD 一致

**验收**

- 页面无“必须 clone 仓库”路径
- 仍保留重新检测 / 同步

---

### N10 — E2E verification + docs/compat

**目标**：闭环验收与文档收口。

**任务**

1. 本地剧本：
   - fresh CLI install
   - init/auth
   - bridge install/start
   - knowledge init/start
   - doctor
   - sync
   - articles/topics list
2. 兼容说明：
   - `lumina-bridge` / `install-topic-bridge.sh` 仍可用多久
3. 更新：
   - `docs/trd/lumina-cli-command-spec.md` 状态
   - `bridge/README.md`
   - 可选 root README 指向 CLI
4. 基础测试：
   - config roundtrip unit
   - provider registry unit
   - bridge status parsing unit

**依赖**：N1–N9  
**验证**：见第 8 节验收清单

---

## 7. Delivery Sequence (recommended sprints)

### Sprint A — Foundations（N1/N2/N5 部分）

- 配置模型
- CLI 骨架
- remote api get/list 先打通

**Checkpoint**：能 `config/auth/api get` 连上本地 Lumina。

### Sprint B — Local runtime（N3/N4/N6）

- bridge 收编
- llm_wiki adapter
- doctor/up/down

**Checkpoint**：`lumina up && lumina doctor` 在本机全绿或可解释黄灯。

### Sprint C — Sync + install entry（N7/N8）

- sync 命令
- install-lumina-cli.sh
- update

**Checkpoint**：干净安装路径 + `lumina sync` 成功。

### Sprint D — Product surfaces（N9/N10）

- 设置页引导
- 文档与兼容
- E2E 清单签字

**Checkpoint**：主题解析页只引导 CLI；P0 验收全过。

---

## 8. Acceptance Checklist

### A. Install path

- [ ] 无 monorepo 时可通过 install script 安装 CLI
- [ ] `lumina bridge install` 成功
- [ ] `lumina up` 后 `/health` 可访问

### B. Config/auth

- [ ] profile 切换生效
- [ ] token 脱敏
- [ ] `whoami` / `config validate` 可用

### C. Knowledge abstraction

- [ ] `knowledge providers` 列出 `llm_wiki`
- [ ] `knowledge use llm_wiki` 不改命令树
- [ ] 未来第二 provider 只需加 adapter，不改用户主命令

### D. Sync loop

- [ ] `lumina sync` 触发 bridge 同步
- [ ] `sync status` 可观测
- [ ] 失败分层提示

### E. Remote read

- [ ] `articles list/get`
- [ ] `topics list/get`
- [ ] `api get /api/...`

### F. Settings

- [ ] 本机安装弹窗是 CLI 命令
- [ ] 无 `cd bridge` 主路径

---

## 9. Test Plan

| 层级 | 内容 |
|---|---|
| Unit | config IO、provider registry、exit code mapping、URL join |
| Component | bridge status parser、llm_wiki detect/status mocked |
| Integration | local Lumina + bridge + sync（开发机） |
| Manual | 设置页文案、干净 shell PATH、doctor next-step |

最少自动化：

```bash
# pseudo
pytest cli/tests -q
lumina doctor --output json
lumina bridge status --output json
```

---

## 10. Docs to update during implementation

1. `docs/trd/lumina-cli-command-spec.md`：P0 落地状态
2. `bridge/README.md`：主入口改为 CLI
3. `scripts/install-lumina-cli.sh`：新脚本
4. （可选）`README.zh-CN.md`：主题解析/本机依赖一节
5. 本执行计划：每完成一个 node 更新 status

---

## 11. Remote Handoff Inputs (optional)

若拆给远程/并行 agent，优先可委托且写集不冲突的包：

| Node | 可委托 | Write set | 禁止写入 | 验收 |
|---|---|---|---|---|
| N5 Remote API client | 是 | `cli/**/http.py`, `cmds/api.py`, `articles.py`, `topics.py` | config schema 最终字段 | api/articles/topics 命令可用 |
| N9 Settings guidance | 是 | `frontend/pages/admin.tsx`, `frontend/lib/i18n.ts` | bridge/cli runtime | 弹窗命令与 N8 一致 |
| N4 llm_wiki adapter | 有限 | `cli/**/knowledge/*` | bridge HTTP 契约 | provider doctor/status |
| N3 Bridge wrapper | 谨慎 | `cli/**/bridge_runtime.py`, install script 片段 | 任意 frontend | bridge start/status |

共享合同（N1 schema、命令树）不并行双写。

---

## 12. Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| Bridge 进程不稳定 | up/sync 不可靠 | N3 先做 doctor/log/pid 硬化 |
| llm_wiki 无法静默安装 | 用户以为 install 失败 | install 区分 `installed/started/guided` 三态 |
| 配置模型中途变更 | 命令返工 | N1 先冻结最小 schema |
| full sync 语义不清 | 命令空头支票 | 实现时显式映射或标记 limited |
| 旧脚本与 CLI 双入口 | 文档混乱 | N10 明确 primary/deprecated |

---

## 13. Suggested Immediate Next Actions

1. 建 `cli/`（或 `packages/lumina-cli/`）骨架，落地 N1/N2  
2. 把 `install-topic-bridge` 核心库化，供 `bridge install` 调用  
3. 抽出 `llm_wiki` adapter，先只做 detect/status/start/init  
4. 打通 `doctor` 与 `sync`  
5. 最后改设置页文案与 `install-lumina-cli.sh`

---

## 14. Summary

P0 不是从零做桌面平台，而是：

1. **收编**现有 bridge 安装与运行时  
2. **抽象** knowledge provider（先接 llm_wiki）  
3. **统一** config/auth/doctor/sync/api 入口  
4. **收敛**设置页到 CLI 引导  

按 DAG 推进，关键路径是：

> Config → CLI skeleton → Bridge wrapper → Provider adapter → Doctor/Up → Sync → Installer → Settings/Docs

## 12. Implementation Notes (2026-07-28)

P0 landed under `cli/lumina_cli` + `scripts/install-lumina-cli.sh`.

Verified locally:

- `lumina init/doctor/up/bridge/knowledge/sync/topics`
- Bridge install/start via CLI wrapper around `~/.lumina/topic-bridge`
- Settings modal + bridge `/setup` commands point to CLI installer
- `llm_wiki` is provider adapter only; user commands stay `knowledge/*`

### Follow-ups landed

- `lumina completion bash|zsh|fish`
- second provider skeleton: `generic_fs`
- Bridge `GET /doctor` + settings page recheck aligned with `lumina doctor`
