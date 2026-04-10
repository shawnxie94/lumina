import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CommentSection, {
  collectCommentDescendantIds,
  collectReplyAncestorIds,
  collectReplyThreadIds,
  extractCommentIdFromHash,
  extractCommentIdFromLink,
  resolveCommentLocation,
} from "@/components/comment/CommentSection";
import { ToastProvider } from "@/components/Toast";
import { BasicSettingsProvider } from "@/contexts/BasicSettingsContext";

globalThis.React = React;

function readSource(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

type CommentFixture = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  user_github_url: string;
  is_hidden: boolean;
  reply_to_id: string | null;
};

function createComment(overrides: Partial<CommentFixture> = {}): CommentFixture {
  return {
    id: overrides.id ?? "comment-1",
    content: overrides.content ?? "第一条评论",
    created_at: overrides.created_at ?? "2026-04-09T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-09T10:00:00.000Z",
    user_id: overrides.user_id ?? "user-1",
    user_name: overrides.user_name ?? "Shawn",
    user_avatar: overrides.user_avatar ?? "https://example.com/avatar.png",
    user_github_url: overrides.user_github_url ?? "https://github.com/shawn",
    is_hidden: overrides.is_hidden ?? false,
    reply_to_id: overrides.reply_to_id ?? null,
  };
}

function renderCommentSection(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(
      BasicSettingsProvider,
      null,
      React.createElement(
        ToastProvider,
        null,
        React.createElement(CommentSection as any, props),
      ),
    ),
  );
}

const baseProps = {
  comments: [createComment()],
  session: null,
  isAdmin: false,
  onSubmitComment: async () => undefined,
  onUpdateComment: async () => undefined,
  onDeleteComment: async () => undefined,
};

test("CommentSection renders the article-style header with auth actions", () => {
  const html = renderCommentSection({
    ...baseProps,
    comments: [createComment(), createComment({ id: "comment-2", user_id: "user-2", user_name: "Ava" })],
    commentProviders: { github: true, google: true },
    onSignIn: () => undefined,
  });

  assert.equal(html.includes("评论"), true);
  assert.equal(html.includes("(2)"), true);
  assert.equal(html.includes("GitHub 登录"), true);
  assert.equal(html.includes("Google 登录"), true);
});

test("CommentSection keeps article-style chrome visible while comments are loading", () => {
  const html = renderCommentSection({
    ...baseProps,
    loading: true,
    session: {
      user: {
        id: "user-1",
        name: "Shawn",
        image: "https://example.com/avatar.png",
      },
    },
    onSignOut: () => undefined,
  });

  assert.equal(html.includes("评论加载中..."), true);
  assert.equal(html.includes("评论"), true);
  assert.equal(html.includes("Shawn"), true);
  assert.equal(html.includes("发布评论"), true);
});

test("CommentSection matches article-detail pagination chrome and omits hidden badge", () => {
  const html = renderCommentSection({
    ...baseProps,
    comments: [
      createComment({ id: "comment-1", is_hidden: true }),
      createComment({ id: "comment-2", user_id: "user-2", user_name: "Ava" }),
      createComment({ id: "comment-3", user_id: "user-3", user_name: "Kai" }),
    ],
    pageSize: 2,
  });

  assert.equal(
    html.includes("mt-4 flex items-center justify-between text-xs text-text-3"),
    true,
  );
  assert.equal(
    html.includes("px-4 py-2 text-sm bg-surface border border-border rounded-sm text-text-2"),
    true,
  );
  assert.equal(html.includes("已隐藏"), false);
});

test("comment link helpers extract the target comment id from hash and absolute URLs", () => {
  assert.equal(extractCommentIdFromHash("#comment-reply-2"), "reply-2");
  assert.equal(extractCommentIdFromHash("#other-anchor"), "");
  assert.equal(
    extractCommentIdFromLink("https://lumina.test/reviews/demo#comment-root-1"),
    "root-1",
  );
  assert.equal(extractCommentIdFromLink("#comment-inline-3"), "inline-3");
});

test("resolveCommentLocation finds the correct page for nested replies", () => {
  const comments = [
    createComment({ id: "top-new", created_at: "2026-04-09T10:00:00.000Z" }),
    createComment({ id: "top-middle", created_at: "2026-04-08T10:00:00.000Z" }),
    createComment({ id: "top-old", created_at: "2026-04-07T10:00:00.000Z" }),
    createComment({
      id: "reply-old",
      created_at: "2026-04-09T11:00:00.000Z",
      reply_to_id: "top-old",
      user_id: "user-9",
      user_name: "Nina",
    }),
  ];

  assert.deepEqual(resolveCommentLocation("reply-old", comments as any, 2), {
    topCommentId: "top-old",
    page: 2,
  });
  assert.equal(resolveCommentLocation("missing", comments as any, 2), null);
});

test("collectReplyAncestorIds returns the full ancestor chain for deep replies", () => {
  const comments = [
    createComment({ id: "top-1" }),
    createComment({
      id: "reply-1",
      reply_to_id: "top-1",
      user_id: "user-2",
      user_name: "Ava",
    }),
    createComment({
      id: "reply-2",
      reply_to_id: "reply-1",
      user_id: "user-3",
      user_name: "Kai",
    }),
  ];

  assert.deepEqual(collectReplyAncestorIds("reply-2", comments as any), [
    "top-1",
    "reply-1",
  ]);
  assert.deepEqual(collectReplyAncestorIds("top-1", comments as any), []);
});

test("collectReplyThreadIds includes ancestors and the replied comment itself", () => {
  const comments = [
    createComment({ id: "top-1" }),
    createComment({
      id: "reply-1",
      reply_to_id: "top-1",
      user_id: "user-2",
      user_name: "Ava",
    }),
    createComment({
      id: "reply-2",
      reply_to_id: "reply-1",
      user_id: "user-3",
      user_name: "Kai",
    }),
  ];

  assert.deepEqual(collectReplyThreadIds("reply-2", comments as any), [
    "top-1",
    "reply-1",
    "reply-2",
  ]);
  assert.deepEqual(collectReplyThreadIds("top-1", comments as any), ["top-1"]);
});

test("collectCommentDescendantIds returns all nested descendants for any comment", () => {
  const comments = [
    createComment({ id: "top-1" }),
    createComment({
      id: "reply-1",
      reply_to_id: "top-1",
      user_id: "user-2",
      user_name: "Ava",
    }),
    createComment({
      id: "reply-2",
      reply_to_id: "reply-1",
      user_id: "user-3",
      user_name: "Kai",
    }),
    createComment({
      id: "reply-3",
      reply_to_id: "reply-2",
      user_id: "user-4",
      user_name: "Nina",
    }),
  ];

  assert.deepEqual(collectCommentDescendantIds("reply-1", comments as any), [
    "reply-2",
    "reply-3",
  ]);
  assert.deepEqual(collectCommentDescendantIds("top-1", comments as any), [
    "reply-1",
    "reply-2",
    "reply-3",
  ]);
  assert.deepEqual(collectCommentDescendantIds("missing", comments as any), []);
});

test("CommentSection includes nested replies in the thread reply count", () => {
  const html = renderCommentSection({
    ...baseProps,
    comments: [
      createComment({ id: "top-1", created_at: "2026-04-09T10:00:00.000Z" }),
      createComment({
        id: "reply-1",
        reply_to_id: "top-1",
        created_at: "2026-04-09T11:00:00.000Z",
        user_id: "user-2",
        user_name: "Ava",
      }),
      createComment({
        id: "reply-2",
        reply_to_id: "reply-1",
        created_at: "2026-04-09T12:00:00.000Z",
        user_id: "user-3",
        user_name: "Kai",
      }),
    ],
  });

  assert.equal(html.includes("查看回复 (2)"), true);
});

test("CommentSection renders a nested toggle for replies with child replies", () => {
  const html = renderCommentSection({
    ...baseProps,
    initialExpandedReplyIds: ["top-1"],
    comments: [
      createComment({ id: "top-1", created_at: "2026-04-09T10:00:00.000Z" }),
      createComment({
        id: "reply-1",
        reply_to_id: "top-1",
        created_at: "2026-04-09T11:00:00.000Z",
        user_id: "user-2",
        user_name: "Ava",
      }),
      createComment({
        id: "reply-2",
        reply_to_id: "reply-1",
        created_at: "2026-04-09T12:00:00.000Z",
        user_id: "user-3",
        user_name: "Kai",
      }),
    ],
  });

  assert.equal(html.includes("收起回复 (2)"), true);
  assert.equal(html.includes("查看回复 (1)"), true);
});

test("CommentSection keeps reply avatars clickable when github profile links exist", () => {
  const html = renderCommentSection({
    ...baseProps,
    initialExpandedReplyIds: ["top-1"],
    comments: [
      createComment({ id: "top-1", user_github_url: "https://github.com/top-user" }),
      createComment({
        id: "reply-1",
        reply_to_id: "top-1",
        user_id: "user-2",
        user_name: "Ava",
        user_github_url: "https://github.com/reply-user",
      }),
    ],
  });

  assert.equal(html.includes('href="https://github.com/reply-user"'), true);
});

test("CommentSection keeps delete available for admins even when they are not the comment owner", () => {
  const html = renderCommentSection({
    ...baseProps,
    session: {
      user: {
        id: "admin-user",
        name: "Admin",
        image: "https://example.com/admin.png",
      },
    },
    isAdmin: true,
    onSignOut: () => undefined,
  });

  assert.equal(html.includes('title="删除"'), true);
  assert.equal(html.includes('title="编辑"'), false);
});

test("CommentSection focuses the latest reply input after reply target changes", () => {
  const source = readSource("components/comment/CommentSection.tsx");

  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*replyTargetId[\s\S]*document\.getElementById\(`reply-box-\$\{replyTargetId\}`\)[\s\S]*commentInputRef\.current\?\.focus\(\);[\s\S]*\}, \[replyTargetId\]\);/,
  );
});

test("CommentSection keeps nested reply submissions attached to the replied comment", () => {
  const source = readSource("components/comment/CommentSection.tsx");

  assert.match(
    source,
    /onReply=\{\(comment\) => handleReplyTo\(comment\)\}/,
  );
  assert.doesNotMatch(
    source,
    /onReply=\{\(comment\) => handleReplyTo\(comment,\s*topCommentId\)\}/,
  );
});

test("CommentSection expands the replied thread when starting a reply", () => {
  const source = readSource("components/comment/CommentSection.tsx");

  assert.match(source, /const expandedIds = collectReplyThreadIds\(comment\.id,\s*comments\);/);
  assert.match(source, /setExpandedReplies\(\(prev\) => \{/);
  assert.match(source, /expandedIds\.forEach\(\(id\) => \{\s*next\[id\] = true;/);
});

test("CommentSection re-highlights comment anchors clicked from rendered comment bodies", () => {
  const source = readSource("components/comment/CommentSection.tsx");

  assert.match(source, /window\.addEventListener\("hashchange",\s*handleHashChange\)/);
  assert.match(source, /const commentId = extractCommentIdFromLink\(anchor\.getAttribute\("href"\) \|\| ""\);/);
  assert.match(source, /onClickCapture=\{handleCommentBodyClick\}/);
});
