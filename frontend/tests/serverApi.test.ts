import test from "node:test";
import assert from "node:assert/strict";

import { fetchServerArticle } from "@/lib/serverApi";

test("fetchServerArticle forwards incoming request cookies to backend fetch", async () => {
  const originalFetch = global.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "1", slug: "hidden-article" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await fetchServerArticle(
      {
        headers: {
          host: "localhost:3000",
          cookie: "lumina_admin_token=test-cookie-value",
        },
      } as never,
      "hidden-article",
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.init?.headers
      ? (calls[0].init.headers as Record<string, string>).cookie
      : undefined,
    "lumina_admin_token=test-cookie-value",
  );
});
