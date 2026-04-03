import test from "node:test";
import assert from "node:assert/strict";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TagSelectField from "@/components/ui/TagSelectField";

globalThis.React = React;

const tags = [
  { id: "1", name: "Claude插件" },
  { id: "2", name: "LettaSDK" },
  { id: "3", name: "代码库" },
];

test("TagSelectField keeps multiline layout by default", () => {
  const html = renderToStaticMarkup(
    React.createElement(TagSelectField as any, {
      tags,
      value: ["1", "2"],
      onChange: () => {},
    }),
  );

  assert.equal(html.includes("select-modern-antd-multiline"), true);
});

test("TagSelectField can render in single-line mode", () => {
  const html = renderToStaticMarkup(
    React.createElement(TagSelectField as any, {
      tags,
      value: ["1", "2"],
      onChange: () => {},
      multiline: false,
    }),
  );

  assert.equal(html.includes("select-modern-antd-multiline"), false);
  assert.equal(html.includes('style="height:36px"'), true);
});
