import test from "node:test";
import assert from "node:assert/strict";

import { parseQuickDateOption } from "@/lib/listFilters";

test("parseQuickDateOption defaults missing values to all", () => {
  assert.equal(parseQuickDateOption(undefined), "");
  assert.equal(parseQuickDateOption(""), "");
});

test("parseQuickDateOption keeps known quick date values", () => {
  assert.equal(parseQuickDateOption("1d"), "1d");
  assert.equal(parseQuickDateOption("1m"), "1m");
});

test("parseQuickDateOption rejects unknown values", () => {
  assert.equal(parseQuickDateOption("custom"), "");
});
