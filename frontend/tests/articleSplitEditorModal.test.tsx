import test from "node:test";
import assert from "node:assert/strict";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ArticleSplitEditorModal from "@/components/article/ArticleSplitEditorModal";
import { BasicSettingsProvider } from "@/contexts/BasicSettingsContext";

globalThis.React = React;

test("ArticleSplitEditorModal lets the preview pane fill the right column on wide screens", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      BasicSettingsProvider,
      null,
      React.createElement(ArticleSplitEditorModal as any, {
        isOpen: true,
        title: "创建文章",
        closeAriaLabel: "关闭创建文章弹窗",
        onClose: () => {},
        onSave: () => {},
        topFields: React.createElement("div", null, "top fields"),
        contentValue: "# Hello",
        onContentChange: () => {},
        saveText: "创建",
        savingText: "创建中...",
        isSaving: false,
        previewImageUrl: "/cover.png",
        previewImageAlt: "预览封面",
        previewHtml: "<p>preview</p>",
      }),
    ),
  );

  assert.equal(html.includes("lg:grid-cols-2"), true);
  assert.equal(html.includes("max-w-3xl mx-auto"), false);
  assert.equal(html.includes("w-full min-h-full bg-surface shadow-sm"), true);
});
