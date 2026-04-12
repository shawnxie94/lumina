import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  scripts?: Record<string, string>;
};

test("frontend npm test script includes the dedicated tests directory", () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;

  const testScript = packageJson.scripts?.test || "";
  assert.match(testScript, /tests\/\*\.test\.ts/);
  assert.match(testScript, /tests\/\*\.test\.tsx/);
});
