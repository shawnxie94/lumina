import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AITaskListItem } from "@/lib/api";

test("ai task list item supports chain metadata", () => {
	const item: AITaskListItem = {
		id: "task-root",
		root_task_id: "task-root",
		latest_task_id: "task-cont-1",
		chain_length: 2,
		has_continuations: true,
		article_id: "article-1",
		article_title: "任务标题",
		article_slug: "article-1",
		article_kind: "article",
		task_type: "process_ai_content",
		content_type: "summary",
		status: "failed",
		attempts: 1,
		max_attempts: 1,
		run_at: "2026-04-13T10:00:00",
		locked_at: null,
		locked_by: null,
		last_error: "too long",
		last_error_type: "validation",
		created_at: "2026-04-13T10:00:00",
		updated_at: "2026-04-13T10:06:00",
		finished_at: "2026-04-13T10:06:00",
	};

	assert.equal(item.chain_length, 2);
	assert.equal(item.latest_task_id, "task-cont-1");
});

test("admin task timeline no longer exposes continuation actions", async () => {
	const source = await readFile(
		new URL("../pages/admin.tsx", import.meta.url),
		"utf8",
	);

	assert.doesNotMatch(source, /continueAIUsage/);
	assert.doesNotMatch(source, /Continuation/);
	assert.doesNotMatch(source, /handleSubmitAIContinuation/);
});
