import test from "node:test";
import assert from "node:assert/strict";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import FilterSelect from "@/components/FilterSelect";
import FilterSelectInline from "@/components/FilterSelectInline";

globalThis.React = React;

const options = [
  { value: "", label: "全部" },
  { value: "1d", label: "1天内" },
];

test("FilterSelectInline can disable search for compact enum filters", () => {
  const html = renderToStaticMarkup(
    React.createElement(FilterSelectInline as any, {
      label: "创建时间：",
      value: "",
      onChange: () => {},
      options,
      showSearch: false,
    }),
  );

  assert.equal(html.includes("ant-select-show-search"), false);
  assert.equal(html.includes("全部"), true);
});

test("FilterSelect can disable search for simple mobile filters", () => {
  const html = renderToStaticMarkup(
    React.createElement(FilterSelect as any, {
      label: "创建时间",
      value: "",
      onChange: () => {},
      options,
      showSearch: false,
    }),
  );

  assert.equal(html.includes("ant-select-show-search"), false);
  assert.equal(html.includes("全部"), true);
});
