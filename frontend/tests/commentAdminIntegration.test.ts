import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
  return readFileSync(join(frontendRoot, relativePath), "utf8");
}

// admin 页面按 section 拆分到 components/admin/ 后，源码结构断言应覆盖全部 admin 源文件。
function readAdminSources() {
  const adminDir = join(frontendRoot, "components", "admin");
  const files = [
    join(frontendRoot, "pages", "admin.tsx"),
    ...readdirSync(adminDir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => join(adminDir, name)),
  ];
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

// 专栏详情页按编辑器/正文/侧栏拆分到 components/columns/ 后，源码结构断言应覆盖页面与拆分组件的拼接源码。
function readColumnDetailSources() {
  const columnsDir = join(frontendRoot, "components", "columns");
  const files = [
    join(frontendRoot, "pages", "columns", "[slug].tsx"),
    ...readdirSync(columnsDir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => join(columnsDir, name)),
  ];
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

test("app header routes review comment notifications to review detail pages", () => {
  const source = readPageSource("components/AppHeader.tsx");

  assert.match(source, /comment\.resource_type === ['"]review['"]/);
  assert.match(source, /\/columns\/\$\{/);
});

test("admin monitoring comments page routes delete through the admin comment api", () => {
  const source = readAdminSources();

  assert.match(source, /reviewCommentApi\.toggleHidden/);
  assert.match(source, /commentAdminApi\.delete\(comment\.id,\s*comment\.resource_type\)/);
  assert.doesNotMatch(source, /reviewCommentApi\.deleteComment/);
  assert.match(source, /comment\.resource_type === ['"]review['"]/);
  assert.match(source, /\/columns\/\$\{/);
});

test("review detail page uses admin-compatible delete path for review comments", () => {
  const source = readPageSource("pages/columns/[slug].tsx");

  assert.match(source, /if \(isAdmin\) \{\s*await commentAdminApi\.delete\(commentId,\s*"review"\);/);
  assert.match(source, /await reviewCommentApi\.deleteComment\(commentId\);/);
});

test("review detail page keeps total comment count when reusing CommentSection", () => {
  const source = readColumnDetailSources();

  assert.match(
    source,
    /import CommentSection from ["']@\/components\/comment\/CommentSection["'];/,
  );
  assert.match(source, /<CommentSection[\s\S]*displayCommentCount=\{displayCommentCount\}/);
});

test("review detail page removes comment-header leftovers after extraction", () => {
  const source = readPageSource("pages/columns/[slug].tsx");

  assert.doesNotMatch(source, /const \[showUserMenu, setShowUserMenu\] = useState/);
  assert.doesNotMatch(source, /const userMenuRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.doesNotMatch(source, /const repliesByParent = useMemo/);
  assert.doesNotMatch(source, /const \[pendingDeleteCommentId, setPendingDeleteCommentId\] = useState/);
  assert.doesNotMatch(source, /const \[showDeleteCommentModal, setShowDeleteCommentModal\] = useState/);
  assert.doesNotMatch(source, /onDeleteComment=\{async \(id\) => \{/);
});

test("review detail page removes deleted reply descendants from local comment state", () => {
  const source = readPageSource("pages/columns/[slug].tsx");

  assert.match(
    source,
    /collectCommentDescendantIds\(commentId,\s*prev\)/,
  );
  assert.match(
    source,
    /const idsToRemove = new Set\(\[\s*commentId,\s*\.\.\.collectCommentDescendantIds\(commentId,\s*prev\),?\s*\]\)/,
  );
});

test("admin comments filter uses a generic title search and target column only shows 查看", () => {
  const source = readAdminSources();

  assert.match(source, /label=\{t\("标题"\)\}/);
  assert.doesNotMatch(source, /label=\{t\("文章 \/ 回顾"\)\}/);
  assert.doesNotMatch(source, /\{getCommentResourceLabel\(comment\)\} · \{getCommentTargetTitle\(comment\)\}/);
});

test("app header strips quoted original comment metadata from notification previews", () => {
  const source = readPageSource("components/AppHeader.tsx");

  assert.match(
    source,
    /import \{\s*extractCommentBody\s*\} from ['"]@\/components\/comment\/CommentSection['"]/,
  );
  assert.match(source, /const bodyContent = extractCommentBody\(comment\.content\)/);
});
