import test from "node:test";
import assert from "node:assert/strict";

import { buildArticleHref } from "@/lib/articlePreview";

test("buildArticleHref omits from by default for all article links", () => {
  const publicHref = buildArticleHref("public-slug", {
    from: "/list#article-public-slug",
  });
  const hiddenHref = buildArticleHref("hidden-slug", {
    from: "/list#article-hidden-slug",
    adminPreview: true,
  });

  assert.equal(publicHref, "/article/public-slug");
  assert.equal(hiddenHref, "/article/hidden-slug");
});

test("buildArticleHref keeps from only when explicitly requested", () => {
  const publicHref = buildArticleHref("public-slug", {
    from: "/list#article-public-slug",
    preserveFrom: true,
  });
  const hiddenHref = buildArticleHref("hidden-slug", {
    from: "/list#article-hidden-slug",
    adminPreview: true,
    preserveFrom: true,
  });

  assert.equal(
    publicHref,
    "/article/public-slug?from=%2Flist%23article-public-slug",
  );
  assert.equal(
    hiddenHref,
    "/article/hidden-slug?from=%2Flist%23article-hidden-slug",
  );
});
