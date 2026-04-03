import test from "node:test";
import assert from "node:assert/strict";

const defaultRuntimeCaching = require("next-pwa/cache");

import {
  buildRuntimeCaching,
  DISABLED_DEFAULT_CACHE_NAMES,
} from "../pwaRuntimeCaching";

test("buildRuntimeCaching removes stale-prone default page caches", () => {
  const runtimeCaching = buildRuntimeCaching(defaultRuntimeCaching);
  const cacheNames = runtimeCaching
    .map((entry) => entry?.options?.cacheName)
    .filter((value): value is string => Boolean(value));

  for (const cacheName of DISABLED_DEFAULT_CACHE_NAMES) {
    assert.equal(cacheNames.includes(cacheName), false);
  }
});

test("buildRuntimeCaching adds network-only guards for documents and next data", () => {
  const runtimeCaching = buildRuntimeCaching(defaultRuntimeCaching);

  const hasDocumentGuard = runtimeCaching.some(
    (entry) => entry.handler === "NetworkOnly" && typeof entry.urlPattern === "function",
  );
  const hasNextDataGuard = runtimeCaching.some(
    (entry) =>
      entry.handler === "NetworkOnly" &&
      typeof entry.urlPattern === "function" &&
      entry.urlPattern({ url: new URL("http://localhost:3000/_next/data/build/list.json") }),
  );

  assert.equal(hasDocumentGuard, true);
  assert.equal(hasNextDataGuard, true);
});
