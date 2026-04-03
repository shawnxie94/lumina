import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_SELECT_VALUE_SENTINEL,
  denormalizeSingleSelectValue,
  normalizeSingleSelectOptions,
  normalizeSingleSelectValue,
} from "@/components/ui/selectFieldValue";

test("normalizeSingleSelectValue maps empty string to sentinel", () => {
  assert.equal(normalizeSingleSelectValue(""), EMPTY_SELECT_VALUE_SENTINEL);
});

test("normalizeSingleSelectValue keeps non-empty values unchanged", () => {
  assert.equal(normalizeSingleSelectValue("created_at_desc"), "created_at_desc");
  assert.equal(normalizeSingleSelectValue(undefined), undefined);
});

test("normalizeSingleSelectOptions remaps empty option values for antd select", () => {
  assert.deepEqual(
    normalizeSingleSelectOptions([
      { value: "", label: "全部" },
      { value: "1d", label: "1天内" },
    ]),
    [
      { value: EMPTY_SELECT_VALUE_SENTINEL, label: "全部" },
      { value: "1d", label: "1天内" },
    ],
  );
});

test("denormalizeSingleSelectValue restores sentinel back to empty string", () => {
  assert.equal(denormalizeSingleSelectValue(EMPTY_SELECT_VALUE_SENTINEL), "");
  assert.equal(denormalizeSingleSelectValue("1d"), "1d");
});
