import test from "node:test";
import assert from "node:assert/strict";

import {
  getAITaskFilterOptions,
  getAITaskLabel,
  getAIUsageFilterOptions,
  getRetryPromptTypeForTask,
} from "@/lib/aiTaskMeta";

const t = (key: string) => key;

test("ai task metadata returns unified display labels", () => {
  assert.equal(getAITaskLabel("generate_review_issue", null, t), "回顾");
  assert.equal(
    getAITaskLabel("process_article_embedding", "embedding", t),
    "向量化",
  );
  assert.equal(
    getAITaskLabel("process_article_translation", "translation_title", t),
    "标题翻译",
  );
});

test("ai task metadata exposes task monitor filter labels with 回顾 text", () => {
  const options = getAITaskFilterOptions(t);

  assert.ok(
    options.some(
      (option) => option.value === "generate_review_issue" && option.label === "回顾",
    ),
  );
});

test("ai task metadata exposes usage filter options for embedding and title translation", () => {
  const options = getAIUsageFilterOptions(t);

  assert.ok(
    options.some(
      (option) =>
        option.value === "process_article_embedding:embedding" &&
        option.label === "向量化",
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.value === "process_article_translation:translation_title" &&
        option.label === "标题翻译",
    ),
  );
});

test("ai task metadata reuses one retry prompt type mapping", () => {
  assert.equal(
    getRetryPromptTypeForTask("process_article_translation", "translation_title"),
    "translation",
  );
  assert.equal(getRetryPromptTypeForTask("generate_review_issue", null), null);
});
