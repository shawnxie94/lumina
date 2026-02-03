import { Readability } from '@mozilla/readability';
import { getSiteAdapter, extractWithAdapter } from '../utils/siteAdapters';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'EXTRACT_ARTICLE') {
        const result = extractArticle();
        sendResponse(result);
      }
      return true;
    });
  },
});

interface ExtractedArticle {
  title: string;
  content_html: string;
  source_url: string;
  top_image: string | null;
  author: string;
  published_at: string;
  source_domain: string;
  excerpt: string;
}

function extractArticle(): ExtractedArticle {
  processLazyImages();

  const baseUrl = window.location.href;
  const meta = extractMetadata();

  const adapter = getSiteAdapter(baseUrl);
  if (adapter) {
    const adapterResult = extractWithAdapter(adapter);
    const contentHtml = resolveRelativeUrls(adapterResult.contentHtml, baseUrl);
    
    return {
      title: adapterResult.title || meta.title || document.title,
      content_html: contentHtml,
      source_url: baseUrl,
      top_image: meta.topImage || extractFirstImage(contentHtml),
      author: adapterResult.author || meta.author,
      published_at: adapterResult.publishedAt || meta.publishedAt,
      source_domain: new URL(baseUrl).hostname,
      excerpt: meta.description,
    };
  }

  const doc = document.cloneNode(true) as Document;
  const reader = new Readability(doc, {
    charThreshold: 100,
  });
  const article = reader.parse();

  if (article) {
    const contentHtml = resolveRelativeUrls(article.content, baseUrl);
    const topImage = meta.topImage || extractFirstImage(contentHtml);

    return {
      title: article.title || meta.title || document.title,
      content_html: contentHtml,
      source_url: baseUrl,
      top_image: topImage,
      author: article.byline || meta.author,
      published_at: article.publishedTime || meta.publishedAt,
      source_domain: new URL(baseUrl).hostname,
      excerpt: article.excerpt || meta.description,
    };
  }

  const fallbackContent = extractFallbackContent();
  const contentHtml = resolveRelativeUrls(fallbackContent, baseUrl);

  return {
    title: meta.title || document.title,
    content_html: contentHtml,
    source_url: baseUrl,
    top_image: meta.topImage || extractFirstImage(contentHtml),
    author: meta.author,
    published_at: meta.publishedAt,
    source_domain: new URL(baseUrl).hostname,
    excerpt: meta.description,
  };
}

function processLazyImages(): void {
  const lazyAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'];

  const isPlaceholder = (src: string): boolean => {
    if (!src) return true;
    if (src.startsWith('data:image/svg+xml')) return true;
    if (src.startsWith('data:image/gif;base64,R0lGOD')) return true;
    if (src.includes('1x1') || src.includes('placeholder') || src.includes('blank')) return true;
    if (src.includes('spacer') || src.includes('loading')) return true;
    return false;
  };

  document.querySelectorAll('img').forEach((img) => {
    const currentSrc = img.getAttribute('src') || '';
    const shouldReplace = !currentSrc || isPlaceholder(currentSrc);

    for (const attr of lazyAttrs) {
      const lazySrc = img.getAttribute(attr);
      if (lazySrc && shouldReplace) {
        img.setAttribute('src', lazySrc);
        break;
      }
    }

    const srcset = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
    if (srcset && !img.srcset) {
      img.srcset = srcset;
    }
  });

  document.querySelectorAll('picture source').forEach((source) => {
    const lazySrcset = source.getAttribute('data-srcset');
    if (lazySrcset) {
      source.setAttribute('srcset', lazySrcset);
    }
  });
}

interface Metadata {
  title: string;
  author: string;
  publishedAt: string;
  topImage: string | null;
  description: string;
}

function extractMetadata(): Metadata {
  const getMeta = (selectors: string[]): string => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLMetaElement && el.content) {
        return el.content;
      }
      if (el?.textContent?.trim()) {
        return el.textContent.trim();
      }
    }
    return '';
  };

  return {
    title: getMeta([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]),
    author: getMeta([
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="twitter:creator"]',
      '[rel="author"]',
      '.author',
      '.byline',
    ]),
    publishedAt: getMeta([
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="published_time"]',
      'meta[property="article:published"]',
      'meta[name="date"]',
      'meta[property="og:published_time"]',
      'time[datetime]',
    ]),
    topImage: getMeta([
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ]) || null,
    description: getMeta([
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]),
  };
}

function extractFallbackContent(): string {
  const selectorsToTry = [
    'article',
    '[role="article"]',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.post',
    '.article',
  ];

  let articleElement: Element | null = null;
  for (const selector of selectorsToTry) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      articleElement = el;
      break;
    }
  }

  if (!articleElement) {
    articleElement = document.body;
  }

  const clone = articleElement.cloneNode(true) as Element;
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'header', 'footer', 'aside',
    '.nav', '.navigation', '.menu', '.sidebar', '.widget',
    '.ads', '.ad', '.advertisement', '.advert',
    '.comments', '.comment', '#comments', '.comment-section',
    '.share', '.social', '.social-share',
    '.related', '.related-posts', '.recommended',
    '.newsletter', '.subscribe',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
  ];

  removeSelectors.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });

  return clone.innerHTML;
}

function resolveRelativeUrls(html: string, baseUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const base = new URL(baseUrl);

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('data:') && !src.startsWith('http')) {
      try {
        img.setAttribute('src', new URL(src, base).href);
      } catch {
        // Invalid URL, keep original
      }
    }
  });

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('http')) {
      try {
        a.setAttribute('href', new URL(href, base).href);
      } catch {
        // Invalid URL, keep original
      }
    }
  });

  return doc.body.innerHTML;
}

function extractFirstImage(html: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const img = doc.querySelector('img[src]');
  return img?.getAttribute('src') || null;
}
