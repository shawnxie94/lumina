# Content Workflow Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复手动创建文章时头图未使用转储后链接的问题，并把后台备份导出改为“后台生成后下载”的单文件异步流程。

**Architecture:** 文章创建继续沿用现有“先创建再补写”的交互，只把头图转储纳入同一轮补写逻辑，并抽出一个小型前端 helper 方便测试。备份导出不引入数据库，改为“进程内状态 + 磁盘单文件 + 启动自恢复”，后端新增最新导出状态与下载接口，前端 admin 页面轮询状态并在完成后触发下载。

**Tech Stack:** FastAPI, SQLAlchemy, Next.js pages router, TypeScript, Axios, pytest, node:test

---

## File Map

**Backend**
- Create: `backend/app/domain/backup_export_runtime.py`
  - 单一职责：维护最近一次备份导出的内存状态、并发锁与启动恢复逻辑。
- Modify: `backend/app/domain/backup_service.py`
  - 复用现有 snapshot/zip 构建逻辑，新增“生成到固定文件路径”的能力。
- Modify: `backend/app/api/routers/backup_router.py`
  - 新增最新导出任务启动、状态查询、下载接口。
- Modify: `backend/app/schemas/backup.py`
  - 新增备份导出状态响应模型。
- Modify: `backend/app/schemas/__init__.py`
  - 导出新增备份状态模型。
- Modify: `backend/tests/unit/domain/test_backup_service.py`
  - 覆盖 runtime 状态、单文件替换、失败清理和启动恢复。
- Create: `backend/tests/unit/api/test_backup_router.py`
  - 覆盖 router 的状态返回、重复启动保护、下载失败分支。

**Frontend**
- Create: `frontend/lib/createArticleMedia.ts`
  - 单一职责：根据创建后的 `articleId/slug` 处理正文媒体和头图转储，并给出补写 payload。
- Create: `frontend/lib/backupExport.ts`
  - 单一职责：封装备份导出状态标签、错误文案和展示辅助逻辑，避免继续膨胀 `admin.tsx`。
- Modify: `frontend/pages/list.tsx`
  - 调用 helper，统一补写 `content_md` 与 `top_image`。
- Modify: `frontend/lib/api.ts`
  - 新增备份最新任务状态/启动/下载接口类型。
- Modify: `frontend/pages/admin.tsx`
  - 备份区域改为“生成中/可下载/失败”的轮询交互。
- Create: `frontend/tests/createArticleMedia.test.ts`
  - 覆盖头图转储成功/失败与补写 payload。
- Create: `frontend/tests/backupExport.test.ts`
  - 覆盖 admin 备份状态文案和按钮分支。

## Task 1: 为文章创建补齐头图转储 helper 与前端回归测试

**Files:**
- Create: `frontend/lib/createArticleMedia.ts`
- Create: `frontend/tests/createArticleMedia.test.ts`
- Modify: `frontend/pages/list.tsx`
- Reference: `docs/superpowers/specs/2026-04-12-content-workflow-phase1-design.md`

- [ ] **Step 1: 写失败测试，锁定头图成功转储时的补写 payload**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { resolveCreateArticlePatch } from "@/lib/createArticleMedia";

test("resolveCreateArticlePatch updates top image with ingested url", async () => {
  const result = await resolveCreateArticlePatch({
    originalContent: "hello",
    pendingMedia: [],
    topImage: "https://cdn.example.com/original-cover.png",
    articleId: "article-1",
    mediaStorageEnabled: true,
    ingestUrl: async (_articleId, url) => ({
      url: `/backend/media/${encodeURIComponent(url)}`,
    }),
    uploadFile: async () => {
      throw new Error("not used");
    },
  });

  assert.equal(result.patch.content_md, "hello");
  assert.equal(
    result.patch.top_image,
    "/backend/media/https%3A%2F%2Fcdn.example.com%2Foriginal-cover.png",
  );
  assert.equal(result.transferFailedCount, 0);
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/createArticleMedia.test.ts`
Expected: FAIL，提示 `@/lib/createArticleMedia` 不存在或 `resolveCreateArticlePatch` 未导出。

- [ ] **Step 3: 写最小 helper，实现正文媒体与头图统一补写结果**

```ts
export async function resolveCreateArticlePatch(input: {
  originalContent: string;
  pendingMedia: Array<{
    token: string;
    kind: "file" | "url";
    url?: string;
    file?: File;
    mediaKind: "image" | "book";
  }>;
  topImage: string;
  articleId: string;
  mediaStorageEnabled: boolean;
  ingestUrl: (articleId: string, url: string, mediaKind?: "image" | "book") => Promise<{ url: string }>;
  uploadFile: (articleId: string, file: File) => Promise<{ url: string }>;
}) {
  let patchedContent = input.originalContent;
  let patchedTopImage = input.topImage.trim() || undefined;
  let transferSuccessCount = 0;
  let transferFailedCount = 0;

  for (const item of input.pendingMedia) {
    try {
      const result =
        item.kind === "file" && item.file
          ? await input.uploadFile(input.articleId, item.file)
          : await input.ingestUrl(input.articleId, item.url || "", item.mediaKind);
      patchedContent = patchedContent.split(item.token).join(result.url);
      transferSuccessCount += 1;
    } catch {
      transferFailedCount += 1;
    }
  }

  if (input.mediaStorageEnabled && input.topImage.trim()) {
    try {
      const result = await input.ingestUrl(input.articleId, input.topImage.trim(), "image");
      patchedTopImage = result.url;
      transferSuccessCount += 1;
    } catch {
      transferFailedCount += 1;
      patchedTopImage = input.topImage.trim();
    }
  }

  return {
    patch: {
      content_md: patchedContent,
      top_image: patchedTopImage,
    },
    transferSuccessCount,
    transferFailedCount,
  };
}
```

- [ ] **Step 4: 再补一个失败测试，锁定头图转储失败时回退原始链接**

```ts
test("resolveCreateArticlePatch keeps original top image when ingest fails", async () => {
  const result = await resolveCreateArticlePatch({
    originalContent: "hello",
    pendingMedia: [],
    topImage: "https://cdn.example.com/original-cover.png",
    articleId: "article-1",
    mediaStorageEnabled: true,
    ingestUrl: async () => {
      throw new Error("boom");
    },
    uploadFile: async () => {
      throw new Error("not used");
    },
  });

  assert.equal(result.patch.top_image, "https://cdn.example.com/original-cover.png");
  assert.equal(result.transferFailedCount, 1);
});
```

- [ ] **Step 5: 运行单测确认 helper 通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/createArticleMedia.test.ts`
Expected: PASS，至少 2 个 `resolveCreateArticlePatch` 测试通过。

- [ ] **Step 6: 在创建流程中接入 helper，只在 patch 变化时回写**

```ts
const patchResult = await resolveCreateArticlePatch({
  originalContent,
  pendingMedia,
  topImage: createTopImage.trim(),
  articleId: createdArticleId,
  mediaStorageEnabled: createMediaStorageEnabled,
  ingestUrl: (articleId, url, mediaKind) =>
    mediaApi.ingest(articleId, url, mediaKind),
  uploadFile: (articleId, file) => mediaApi.upload(articleId, file),
});

const shouldPatch =
  patchResult.patch.content_md !== originalContent ||
  (patchResult.patch.top_image || "") !== (createTopImage.trim() || "");

if (shouldPatch && createdArticleSlug) {
  await articleApi.updateArticle(createdArticleSlug, patchResult.patch);
}
```

- [ ] **Step 7: 跑目标测试和构建，确认列表页创建链路可编译**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/createArticleMedia.test.ts && npm run build`
Expected: 测试通过，`/list` 页面参与的 Next.js build 成功。

- [ ] **Step 8: 提交该任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add frontend/lib/createArticleMedia.ts frontend/tests/createArticleMedia.test.ts frontend/pages/list.tsx
git commit -m "feat: patch created article top image after media ingest"
```

### Task 2: 为备份导出增加后端 runtime 状态、单文件落盘与 router 测试

**Files:**
- Create: `backend/app/domain/backup_export_runtime.py`
- Modify: `backend/app/domain/backup_service.py`
- Modify: `backend/app/api/routers/backup_router.py`
- Modify: `backend/app/schemas/backup.py`
- Modify: `backend/app/schemas/__init__.py`
- Modify: `backend/tests/unit/domain/test_backup_service.py`
- Create: `backend/tests/unit/api/test_backup_router.py`

- [ ] **Step 1: 写 domain 失败测试，锁定只保留一个导出文件**

```python
def test_backup_service_export_latest_replaces_previous_archive(tmp_path, db_session):
    service = BackupService(media_root=str(tmp_path / "media"))
    export_root = tmp_path / "backups"

    first = service.export_backup_file(db_session, export_root=export_root)
    second = service.export_backup_file(db_session, export_root=export_root)

    assert first["path"] == second["path"]
    assert list(export_root.glob("*.zip")) == [export_root / "lumina-backup-latest.zip"]
```

- [ ] **Step 2: 运行后端单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_backup_service.py -q`
Expected: FAIL，提示 `export_backup_file` 不存在或断言不成立。

- [ ] **Step 3: 新建 runtime helper，承载进程内状态和锁**

```python
from dataclasses import dataclass, field
from threading import Lock


@dataclass
class BackupExportState:
    status: str = "idle"
    filename: str | None = None
    file_path: str | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class BackupExportRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._state = BackupExportState()

    def snapshot(self) -> BackupExportState:
        return BackupExportState(**self._state.__dict__)
```

- [ ] **Step 4: 在 `BackupService` 中增加固定文件导出与启动恢复**

```python
def export_backup_file(self, db: Session, export_root: Path) -> dict[str, Any]:
    export_root.mkdir(parents=True, exist_ok=True)
    target_path = export_root / "lumina-backup-latest.zip"
    temp_path = export_root / "lumina-backup-latest.zip.tmp"

    if target_path.exists():
        target_path.unlink()
    if temp_path.exists():
        temp_path.unlink()

    with temp_path.open("wb") as output:
        for chunk in self.export_backup_stream(db):
            output.write(chunk)

    temp_path.replace(target_path)
    return {
        "filename": target_path.name,
        "path": str(target_path),
        "file_size": target_path.stat().st_size,
    }
```

- [ ] **Step 5: 为 router 写失败测试，锁定重复启动时直接返回 processing**

```python
def test_start_backup_export_returns_processing_when_job_running(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routers.backup_router.backup_export_runtime.snapshot",
        lambda: type("State", (), {"status": "processing"})(),
    )

    response = client.post("/api/backup/export-jobs/latest")

    assert response.status_code == 200
    assert response.json()["status"] == "processing"
```

- [ ] **Step 6: 运行 router 单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/api/test_backup_router.py -q`
Expected: FAIL，提示新接口不存在或返回格式不符。

- [ ] **Step 7: 新增 schema 和三个 router 接口**

```python
class BackupExportStatusResult(BaseModel):
    status: str
    filename: str | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


@router.post("/api/backup/export-jobs/latest", response_model=BackupExportStatusResult)
async def start_backup_export(...):
    return backup_service.start_latest_export(db)


@router.get("/api/backup/export-jobs/latest", response_model=BackupExportStatusResult)
async def get_latest_backup_export(...):
    return backup_service.get_latest_export_status()
```

并新增下载接口：

```python
@router.get("/api/backup/export-jobs/latest/download")
async def download_latest_backup(...):
    file_path = backup_service.get_latest_export_file_path()
    return FileResponse(file_path, media_type="application/zip", filename="lumina-backup-latest.zip")
```

- [ ] **Step 8: 跑后端备份相关测试，确认 domain 和 router 一起通过**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_backup_service.py tests/unit/api/test_backup_router.py -q`
Expected: PASS，包含单文件替换、processing 复用和下载分支断言。

- [ ] **Step 9: 提交该任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add backend/app/domain/backup_export_runtime.py backend/app/domain/backup_service.py backend/app/api/routers/backup_router.py backend/app/schemas/backup.py backend/app/schemas/__init__.py backend/tests/unit/domain/test_backup_service.py backend/tests/unit/api/test_backup_router.py
git commit -m "feat: add async latest backup export flow"
```

### Task 3: 接入 admin 异步备份导出 UI 与前端状态测试

**Files:**
- Create: `frontend/lib/backupExport.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/pages/admin.tsx`
- Create: `frontend/tests/backupExport.test.ts`

- [ ] **Step 1: 写失败测试，锁定“生成中”和“可下载”两种按钮分支**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { getBackupExportActionLabel } from "@/lib/backupExport";

test("getBackupExportActionLabel returns generating label while processing", () => {
  assert.equal(getBackupExportActionLabel("processing", (key) => key), "生成中...");
});

test("getBackupExportActionLabel returns download label after completion", () => {
  assert.equal(getBackupExportActionLabel("completed", (key) => key), "下载最新备份");
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/backupExport.test.ts`
Expected: FAIL，提示 helper 未实现。

- [ ] **Step 3: 新增前端 API 类型和 helper，避免把状态分支硬编码在 `admin.tsx`**

```ts
export function getBackupExportActionLabel(
  status: "idle" | "processing" | "completed" | "failed",
  t: (key: string) => string,
) {
  if (status === "processing") return t("生成中...");
  if (status === "completed") return t("下载最新备份");
  return t("导出备份");
}

export interface BackupExportJobStatus {
  status: "idle" | "processing" | "completed" | "failed";
  filename?: string | null;
  file_size?: number | null;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

startLatestBackupExport: async (): Promise<BackupExportJobStatus> => {
  const response = await api.post("/api/backup/export-jobs/latest");
  return response.data as BackupExportJobStatus;
},

getLatestBackupExport: async (): Promise<BackupExportJobStatus> => {
  const response = await api.get("/api/backup/export-jobs/latest");
  return response.data as BackupExportJobStatus;
},
```

- [ ] **Step 4: 在 admin 页面接入轮询与下载按钮**

```ts
const [backupExportJob, setBackupExportJob] = useState<BackupExportJobStatus | null>(null);

const handleExportBackup = async () => {
  const job = await backupApi.startLatestBackupExport();
  setBackupExportJob(job);
};

useEffect(() => {
  if (backupExportJob?.status !== "processing") return;
  const timer = window.setInterval(async () => {
    const latest = await backupApi.getLatestBackupExport();
    setBackupExportJob(latest);
  }, 2000);
  return () => window.clearInterval(timer);
}, [backupExportJob?.status]);
```

并把下载按钮切到：

```ts
window.location.href = `${getApiBaseUrl()}/api/backup/export-jobs/latest/download`;
```

- [ ] **Step 5: 跑前端目标测试和 lint**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test -- tests/backupExport.test.ts && npm run lint`
Expected: PASS，无 ESLint 错误。

- [ ] **Step 6: 提交该任务**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add frontend/lib/backupExport.ts frontend/lib/api.ts frontend/pages/admin.tsx frontend/tests/backupExport.test.ts
git commit -m "feat: add admin async backup export status"
```

### Task 4: 做端到端验证并收口文档

**Files:**
- Modify: `docs/superpowers/specs/2026-04-12-content-workflow-phase1-design.md`（仅当实现与设计有必要同步时）
- Reference: `frontend/pages/list.tsx`
- Reference: `frontend/pages/admin.tsx`

- [ ] **Step 1: 跑完整前端验证**

Run: `cd /Users/shawn/Documents/GitHub/lumina/frontend && npm test && npm run build`
Expected: PASS，Next.js build 成功。

- [ ] **Step 2: 跑完整后端验证**

Run: `cd /Users/shawn/Documents/GitHub/lumina/backend && uv run pytest tests/unit/domain/test_backup_service.py tests/unit/api/test_backup_router.py tests/unit/domain/test_article_command_service.py -q`
Expected: PASS，备份与文章相关回归通过。

- [ ] **Step 3: 用 docker compose 做手动冒烟**

Run: `cd /Users/shawn/Documents/GitHub/lumina && docker compose up -d --build`
Expected: `web`, `api`, `worker` 均为 `Up`。

手动检查：

```text
1. 在 /list 创建一篇带外链头图和正文外链图片的文章。
2. 创建完成后打开文章详情，确认头图为 /backend/media/... 或 /media/... 形式的转储后地址。
3. 在 /admin 点击“导出备份”，确认先显示“生成中...”。
4. 状态变为“下载最新备份”后点击下载，确认得到 lumina-backup-latest.zip。
5. 再次点击生成，确认旧文件被替换，没有历史多份残留。
```

- [ ] **Step 4: 若实现和设计有出入，回写 spec；否则只整理 git 状态**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git status --short
```

Expected: 只包含本期实现涉及文件，无无关生成物。

- [ ] **Step 5: 提交收尾验证**

```bash
cd /Users/shawn/Documents/GitHub/lumina
git add \
  frontend/lib/createArticleMedia.ts \
  frontend/lib/backupExport.ts \
  frontend/lib/api.ts \
  frontend/pages/list.tsx \
  frontend/pages/admin.tsx \
  frontend/tests/createArticleMedia.test.ts \
  frontend/tests/backupExport.test.ts \
  backend/app/domain/backup_export_runtime.py \
  backend/app/domain/backup_service.py \
  backend/app/api/routers/backup_router.py \
  backend/app/schemas/backup.py \
  backend/app/schemas/__init__.py \
  backend/tests/unit/domain/test_backup_service.py \
  backend/tests/unit/api/test_backup_router.py
git commit -m "test: verify content workflow phase1"
```

## Self-Review

- Spec coverage:
  - 文章创建头图修正：Task 1
  - 备份导出内存状态 + 单文件落盘：Task 2
  - admin 轮询与下载：Task 3
  - 构建、测试、docker 验证：Task 4
- Placeholder scan:
  - 已避免使用 “TODO / TBD / similar to task N / add appropriate handling” 这类空泛描述。
- Type consistency:
  - 统一使用 `BackupExportJobStatus`
  - 统一使用 `resolveCreateArticlePatch`
  - 固定下载文件名为 `lumina-backup-latest.zip`
