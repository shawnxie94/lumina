import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalPwaCleanupScript,
  clearPwaCaches,
  resetLocalPwaState,
  shouldDisablePwaForLocation,
  syncPwaRegistration,
} from "../lib/pwa";

test("shouldDisablePwaForLocation only disables localhost hosts", () => {
  assert.equal(
    shouldDisablePwaForLocation({ hostname: "localhost", href: "http://localhost:3000/reviews" }),
    true,
  );
  assert.equal(
    shouldDisablePwaForLocation({ hostname: "127.0.0.1", href: "http://127.0.0.1:3000/reviews" }),
    true,
  );
  assert.equal(
    shouldDisablePwaForLocation({ hostname: "lumina.example.com", href: "https://lumina.example.com/reviews" }),
    false,
  );
});

test("clearPwaCaches only deletes lumina and workbox caches", async () => {
  const deleted: string[] = [];
  const changed = await clearPwaCaches({
    async keys() {
      return ["lumina-media-v1", "workbox-precache-v2", "unrelated-cache"];
    },
    async delete(cacheName: string) {
      deleted.push(cacheName);
      return true;
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(deleted, ["lumina-media-v1", "workbox-precache-v2"]);
});

test("resetLocalPwaState unregisters local service workers and clears caches", async () => {
  const unregistered: string[] = [];
  const deleted: string[] = [];

  const changed = await resetLocalPwaState({
    location: { hostname: "localhost", href: "http://localhost:3000/reviews/demo" },
    serviceWorker: {
      async getRegistrations() {
        return [
          {
            active: { scriptURL: "http://localhost:3000/sw.js" },
            async unregister() {
              unregistered.push("sw.js");
              return true;
            },
          },
        ];
      },
      async register() {
        throw new Error("should not register in localhost");
      },
    },
    cacheStorage: {
      async keys() {
        return ["lumina-media-v1", "unrelated-cache"];
      },
      async delete(cacheName: string) {
        deleted.push(cacheName);
        return true;
      },
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(unregistered, ["sw.js"]);
  assert.deepEqual(deleted, ["lumina-media-v1"]);
});

test("syncPwaRegistration registers sw.js for non-localhost domains", async () => {
  const registered: string[] = [];
  const result = await syncPwaRegistration({
    location: { hostname: "lumina.example.com", href: "https://lumina.example.com/reviews/demo" },
    serviceWorker: {
      async getRegistrations() {
        return [];
      },
      async register(scriptUrl: string) {
        registered.push(scriptUrl);
        return {};
      },
    },
  });

  assert.equal(result, "registered");
  assert.deepEqual(registered, ["/sw.js"]);
});

test("syncPwaRegistration clears localhost pwa state without requesting a reload", async () => {
  const result = await syncPwaRegistration({
    location: { hostname: "localhost", href: "http://localhost:3000/reviews/demo" },
    serviceWorker: {
      async getRegistrations() {
        return [
          {
            active: { scriptURL: "http://localhost:3000/sw.js" },
            async unregister() {
              return true;
            },
          },
        ];
      },
      async register() {
        throw new Error("should not register in localhost");
      },
    },
    cacheStorage: {
      async keys() {
        return ["workbox-precache-v1"];
      },
      async delete() {
        return true;
      },
    },
  });

  assert.equal(result, "disabled");
});

test("buildLocalPwaCleanupScript targets localhost cleanup only", () => {
  const script = buildLocalPwaCleanupScript();

  assert.match(script, /localhost/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /serviceWorker\.getRegistrations/);
  assert.match(script, /caches\.delete/);
  assert.doesNotMatch(script, /location\.reload/);
});
