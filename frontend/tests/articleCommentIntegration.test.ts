import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
  return readFileSync(join(frontendRoot, relativePath), "utf8");
}

test("article detail page reuses the shared CommentSection component", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(
    source,
    /import CommentSection,\s*\{\s*collectCommentDescendantIds,\s*\}\s*from "@\/components\/comment\/CommentSection";/,
  );
  assert.match(source, /<CommentSection[\s\S]*comments=\{comments\}/);
  assert.match(source, /<CommentSection[\s\S]*onSubmitComment=\{handleSubmitComment\}/);
  assert.match(source, /<CommentSection[\s\S]*onUpdateComment=\{handleUpdateComment\}/);
});

test("article detail page submits comments through the shared component contract", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(
    source,
    /const handleSubmitComment = async \(\s*content: string,\s*replyToId\?: string \| null,\s*\) =>/,
  );
  assert.match(
    source,
    /await commentApi\.createArticleComment\(\s*id as string,\s*content\.trim\(\),\s*replyToId,\s*\)/,
  );
});

test("article detail page removes page-local comment ui state after extraction", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.doesNotMatch(source, /const \[commentDraft, setCommentDraft\] = useState/);
  assert.doesNotMatch(source, /const \[replyToId, setReplyToId\] = useState/);
  assert.doesNotMatch(source, /const \[expandedReplies, setExpandedReplies\] = useState/);
  assert.doesNotMatch(source, /const \[commentPage, setCommentPage\] = useState/);
  assert.doesNotMatch(source, /const \[pendingDeleteCommentId, setPendingDeleteCommentId\] = useState/);
  assert.doesNotMatch(source, /const \[showDeleteCommentModal, setShowDeleteCommentModal\] = useState/);
  assert.doesNotMatch(source, /onDeleteComment=\{async \(commentId\) => \{/);
});

test("article detail page removes deleted reply descendants from local comment state", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(
    source,
    /collectCommentDescendantIds\(commentId,\s*prev\)/,
  );
  assert.match(
    source,
    /const idsToRemove = new Set\(\[\s*commentId,\s*\.\.\.collectCommentDescendantIds\(commentId,\s*prev\),?\s*\]\)/,
  );
});

test("article detail page uses admin-compatible delete path for article comments", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(source, /if \(isAdmin\) \{\s*await commentAdminApi\.delete\(commentId,\s*"article"\);/);
  assert.match(source, /await commentApi\.deleteComment\(commentId\);/);
});
