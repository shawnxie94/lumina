import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildCanonicalListQuery,
  buildMetaDescription,
  buildRobotsDirectives,
  buildSitemapXml,
  getListPageSeo,
} from "@/lib/seo";
import { fetchAllServerArticles } from "@/lib/serverApi";

test("list SEO allows indexing for plain pagination", () => {
  const seo = getListPageSeo({
    page: "2",
  });

  assert.equal(seo.indexable, true);
  assert.equal(seo.robots, "index,follow");
  assert.deepEqual(buildCanonicalListQuery({ page: "2" }), { page: "2" });
});

test("list SEO allows indexing for a single high-value facet", () => {
  const seo = getListPageSeo({
    category_id: "tech",
    page: "3",
  });

  assert.equal(seo.indexable, true);
  assert.match(seo.title, /tech/i);
  assert.equal(seo.robots, "index,follow");
  assert.deepEqual(buildCanonicalListQuery({ category_id: "tech", page: "3" }), {
    category_id: "tech",
    page: "3",
  });
});

test("list SEO marks low-value search combinations as noindex", () => {
  const seo = getListPageSeo({
    search: "openai",
    category_id: "tech",
    page: "2",
  });

  assert.equal(seo.indexable, false);
  assert.equal(seo.robots, "noindex,follow");
  assert.deepEqual(buildCanonicalListQuery({ search: "openai", category_id: "tech", page: "2" }), {
    category_id: "tech",
  });
});

test("list SEO marks date filters and mixed facets as noindex", () => {
  const seo = getListPageSeo({
    tag_ids: "ai,ml",
    author: "Shawn",
    published_at_start: "2026-01-01",
  });

  assert.equal(seo.indexable, false);
  assert.equal(seo.robots, "noindex,follow");
});

test("robots directives support noindex and nofollow combinations", () => {
  assert.equal(buildRobotsDirectives({ index: true }), "index,follow");
  assert.equal(buildRobotsDirectives({ index: false }), "noindex,follow");
  assert.equal(
    buildRobotsDirectives({ index: false, follow: false, noarchive: true }),
    "noindex,nofollow,noarchive",
  );
});

test("meta description strips tags and truncates long content", () => {
  const description = buildMetaDescription("<p>Hello <strong>world</strong></p>".repeat(40), 120);

  assert.ok(description.startsWith("Hello world"));
  assert.ok(description.length <= 120);
  assert.ok(!description.includes("<strong>"));
});

test("sitemap xml renders urlset entries with optional metadata", () => {
  const xml = buildSitemapXml([
    {
      loc: "https://lumina.example/article/test",
      lastmod: "2026-04-02T00:00:00.000Z",
      changefreq: "weekly",
      priority: 0.8,
    },
    {
      loc: "https://lumina.example/list?page=2",
    },
  ]);

  assert.match(xml, /<urlset/);
  assert.match(xml, /https:\/\/lumina\.example\/article\/test/);
  assert.match(xml, /<changefreq>weekly<\/changefreq>/);
  assert.match(xml, /<priority>0.8<\/priority>/);
  assert.match(xml, /https:\/\/lumina\.example\/list\?page=2/);
});

test("sitemap xml normalizes lastmod values to valid date-only strings", () => {
  const xml = buildSitemapXml([
    {
      loc: "https://lumina.example/article/with-timestamp",
      lastmod: "2026-04-02T10:41:21.738049+00:00",
    },
    {
      loc: "https://lumina.example/article/with-http-date",
      lastmod: "Thu, 02 Apr 2026 21:02:20 GMT",
    },
    {
      loc: "https://lumina.example/article/with-invalid-date",
      lastmod: "not-a-date",
    },
  ]);

  assert.match(xml, /<loc>https:\/\/lumina\.example\/article\/with-timestamp<\/loc><lastmod>2026-04-02<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/lumina\.example\/article\/with-http-date<\/loc><lastmod>2026-04-02<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/lumina\.example\/article\/with-invalid-date<\/loc>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/lumina\.example\/article\/with-invalid-date<\/loc><lastmod>/);
});

const frontendRoot = process.cwd();

function readPageSource(relativePath: string) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

test("login page keeps noindex head in the loading branch", () => {
  const source = readPageSource("pages/login.tsx");
  const loadingBranch = source.match(/if \(isLoading\) \{([\s\S]*?)\n  \}/);

  assert.ok(loadingBranch, "expected to find login loading branch");
  assert.match(loadingBranch[1], /<SeoHead[\s\S]*robots="noindex,nofollow"/);
});

test("extension auth page keeps noindex head in loading and setup branches", () => {
  const source = readPageSource("pages/auth/extension.tsx");
  const loadingBranch = source.match(/if \(isLoading\) \{([\s\S]*?)\n  \}/);
  const setupBranch = source.match(/if \(!isInitialized\) \{([\s\S]*?)\n  \}/);

  assert.ok(loadingBranch, "expected to find extension loading branch");
  assert.ok(setupBranch, "expected to find extension setup branch");
  assert.match(loadingBranch[1], /<SeoHead[\s\S]*robots="noindex,nofollow"/);
  assert.match(setupBranch[1], /<SeoHead[\s\S]*robots="noindex,nofollow"/);
});

test("admin page keeps noindex head in loading and unauthorized branches", () => {
  const source = readPageSource("pages/admin.tsx");
  const loadingBranch = source.match(/if \(authLoading\) \{([\s\S]*?)\n\t\}/);
  const unauthorizedBranch = source.match(/if \(!isAdmin\) \{([\s\S]*?)\n\t\}/);

  assert.ok(loadingBranch, "expected to find admin loading branch");
  assert.ok(unauthorizedBranch, "expected to find admin unauthorized branch");
  assert.match(loadingBranch[1], /<SeoHead[\s\S]*robots="noindex,nofollow"/);
  assert.match(unauthorizedBranch[1], /<SeoHead[\s\S]*robots="noindex,nofollow"/);
});

test("article page keeps breadcrumb structured data but hides visible breadcrumb nav", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(source, /"@type": "BreadcrumbList"/);
  assert.match(source, /aria-label="Breadcrumb"/);
  assert.match(source, /className="sr-only"/);
});

test("list page keeps heading copy available for SEO but hidden from visual UI", () => {
  const source = readPageSource("pages/list.tsx");

  assert.match(source, /<div className="sr-only">/);
  assert.match(source, /listSeo\.description/);
});

test("article structured data uses site logo for publisher metadata", () => {
  const source = readPageSource("pages/article/[id].tsx");

  assert.match(source, /const publisherLogoUrl = resolveSeoAssetUrl\(/);
  assert.match(source, /site_logo_url \|\| "\/logo\.png"/);
  assert.match(source, /logo: publisherLogoUrl/);
});

test("list page only emits collection structured data for indexable aggregations", () => {
  const source = readPageSource("pages/list.tsx");

  assert.match(source, /const listStructuredData = listSeo\.indexable \?/);
  assert.match(source, /structuredData=\{listStructuredData\}/);
});

test("list page renders category filters as crawlable links", () => {
  const source = readPageSource("pages/list.tsx");

  assert.match(source, /const buildCategoryHref = \(categoryId\?: string\) =>/);
  assert.match(source, /<Link\s+href=\{buildCategoryHref\(undefined\)\}/);
  assert.match(source, /<Link\s+href=\{buildCategoryHref\(category\.id\)\}/);
  assert.match(source, /className=\{`block w-full text-left px-3 py-2 rounded-sm transition/);
});

test("fetchAllServerArticles paginates until every page is collected", async () => {
  const calls: string[] = [];
  const originalFetch = global.fetch;

  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page") || "1");
    const payload =
      page === 1
        ? {
            data: [{ slug: "first" }],
            pagination: { page: 1, size: 2, total: 3, total_pages: 2 },
          }
        : {
            data: [{ slug: "second" }, { slug: "third" }],
            pagination: { page: 2, size: 2, total: 3, total_pages: 2 },
          };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const articles = await fetchAllServerArticles(undefined, {
      size: 2,
      sort_by: "published_at_desc",
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0], /page=1/);
    assert.match(calls[1], /page=2/);
    assert.deepEqual(
      articles.map((article) => article.slug),
      ["first", "second", "third"],
    );
  } finally {
    global.fetch = originalFetch;
  }
});
