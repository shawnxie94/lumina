import test from "node:test";
import assert from "node:assert/strict";

import {
  getAIContinuationCopy,
  isAIContinuationSupported,
  resolveAIContinuationModelConfigId,
  type AIContinuationTarget,
} from "@/lib/aiContinuation";

const buildTarget = (
  overrides: Partial<AIContinuationTarget> = {},
): AIContinuationTarget => ({
  taskType: "process_ai_content",
  contentType: "summary",
  requestPayload: null,
  sessionInfo: null,
  ...overrides,
});

test("isAIContinuationSupported accepts supported ai content with session info", () => {
  assert.equal(
    isAIContinuationSupported(
      buildTarget({
        contentType: "quotes",
        sessionInfo: { continuation_mode: "provider" },
      }),
    ),
    true,
  );
});

test("isAIContinuationSupported accepts infographic fallback when request payload exists", () => {
  assert.equal(
    isAIContinuationSupported(
      buildTarget({
        contentType: "infographic",
        requestPayload: "{\"messages\":[]}",
      }),
    ),
    true,
  );
});

test("isAIContinuationSupported rejects unsupported task types and content types", () => {
  assert.equal(
    isAIContinuationSupported(
      buildTarget({
        taskType: "process_article_translation",
        contentType: "summary",
        sessionInfo: { continuation_mode: "provider" },
      }),
    ),
    false,
  );
  assert.equal(
    isAIContinuationSupported(
      buildTarget({
        contentType: "translation",
        sessionInfo: { continuation_mode: "provider" },
      }),
    ),
    false,
  );
});

test("isAIContinuationSupported rejects targets without reusable context", () => {
  assert.equal(isAIContinuationSupported(buildTarget()), false);
});

test("getAIContinuationCopy uses repair wording for infographic", () => {
  const copy = getAIContinuationCopy("infographic", (key) => key);

  assert.equal(copy.title, "提交修复说明");
  assert.equal(copy.feedbackLabel, "修复说明");
  assert.equal(copy.submitLabel, "提交修复");
});

test("getAIContinuationCopy uses feedback wording for text outputs", () => {
  const copy = getAIContinuationCopy("summary", (key) => key);

  assert.equal(copy.title, "提交修改意见");
  assert.equal(copy.feedbackLabel, "修改意见");
  assert.equal(copy.submitLabel, "提交意见");
});

test("resolveAIContinuationModelConfigId defaults to the source model when it is still available", () => {
  const modelConfigId = resolveAIContinuationModelConfigId("model-2", [
    { id: "model-1" },
    { id: "model-2" },
  ]);

  assert.equal(modelConfigId, "model-2");
});

test("resolveAIContinuationModelConfigId falls back to default when the source model is unavailable", () => {
  const modelConfigId = resolveAIContinuationModelConfigId("model-2", [
    { id: "model-1" },
  ]);

  assert.equal(modelConfigId, "");
});
