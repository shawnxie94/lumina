import { Readability } from '@mozilla/readability';
import { getSiteAdapter, extractWithAdapter } from '../utils/siteAdapters';
import { parseDate } from '../utils/dateParser';

let cachedResult: { url: string; data: ExtractedArticle } | null = null;

const LAZY_IMAGE_ATTRS = [
  'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url',
  'data-croporisrc', 'data-actualsrc', 'data-echo', 'data-lazyload',
  'data-hi-res-src', 'data-zoom-src', 'data-full-src',
];

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'PING') {
        sendResponse({ pong: true });
      }
      if (message.type === 'EXTRACT_ARTICLE') {
        const forceRefresh = message.forceRefresh === true;
        const result = extractArticle(forceRefresh);
        sendResponse(result);
      }
      if (message.type === 'CHECK_SELECTION') {
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        sendResponse({ hasSelection });
      }
      if (message.type === 'EXTRACT_SELECTION') {
        const result = extractSelection();
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
  isSelection?: boolean;
  quality?: ContentQuality;
}

interface ContentQuality {
  score: number;
  wordCount: number;
  hasImages: boolean;
  hasCode: boolean;
  warnings: string[];
}

interface JsonLdArticle {
  '@type'?: string;
  headline?: string;
  name?: string;
  author?: { name?: string } | string;
  datePublished?: string;
  image?: { url?: string } | string;
  description?: string;
}

function extractSelection(): ExtractedArticle | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  
  if (selectedText.length === 0) {
    return null;
  }

  const container = document.createElement('div');
  container.appendChild(range.cloneContents());

  processLazyImagesInElement(container);

  const baseUrl = window.location.href;
  const contentHtml = resolveRelativeUrls(container.innerHTML, baseUrl);
  const meta = extractMetadata();

  const topImage = extractFirstImage(contentHtml) || meta.topImage;

  return {
    title: meta.title || document.title,
    content_html: contentHtml,
    source_url: baseUrl,
    top_image: topImage,
    author: meta.author,
    published_at: parseDate(meta.publishedAt),
    source_domain: new URL(baseUrl).hostname,
    excerpt: selectedText.slice(0, 200),
    isSelection: true,
  };
}

function isPlaceholderSrc(src: string): boolean {
  if (!src) return true;
  if (src.startsWith('data:image/svg+xml')) return true;
  if (src.startsWith('data:image/gif;base64,R0lGOD')) return true;
  if (src.includes('1x1') || src.includes('placeholder') || src.includes('blank')) return true;
  if (src.includes('spacer') || src.includes('loading')) return true;
  return false;
}

function processLazyImagesInElement(element: HTMLElement): void {
  element.querySelectorAll('img').forEach((img) => {
    const currentSrc = img.getAttribute('src') || '';
    if (isPlaceholderSrc(currentSrc)) {
      for (const attr of LAZY_IMAGE_ATTRS) {
        const lazySrc = img.getAttribute(attr);
        if (lazySrc && !isPlaceholderSrc(lazySrc)) {
          img.setAttribute('src', lazySrc);
          break;
        }
      }
    }
  });

  element.querySelectorAll('picture source').forEach((source) => {
    const lazySrcset = source.getAttribute('data-srcset');
    if (lazySrcset) {
      source.setAttribute('srcset', lazySrcset);
    }
  });
}

function extractJsonLd(): Partial<{ title: string; author: string; publishedAt: string; topImage: string; description: string }> {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  
  for (const script of scripts) {
    try {
      const rawData = JSON.parse(script.textContent || '');
      const dataArray = Array.isArray(rawData) ? rawData : [rawData];
      
      for (const data of dataArray) {
        const article = findArticleInJsonLd(data);
        if (article) {
          const authorValue = article.author;
          let authorName = '';
          if (typeof authorValue === 'string') {
            authorName = authorValue;
          } else if (authorValue && typeof authorValue === 'object' && authorValue.name) {
            authorName = authorValue.name;
          }

          const imageValue = article.image;
          let imageUrl = '';
          if (typeof imageValue === 'string') {
            imageUrl = imageValue;
          } else if (imageValue && typeof imageValue === 'object' && imageValue.url) {
            imageUrl = imageValue.url;
          }

          return {
            title: article.headline || article.name || '',
            author: authorName,
            publishedAt: article.datePublished || '',
            topImage: imageUrl,
            description: article.description || '',
          };
        }
      }
    } catch {
      continue;
    }
  }
  return {};
}

function findArticleInJsonLd(data: JsonLdArticle | { '@graph'?: JsonLdArticle[] }): JsonLdArticle | null {
  const articleTypes = ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'ScholarlyArticle'];
  
  if (data['@type'] && articleTypes.includes(data['@type'])) {
    return data as JsonLdArticle;
  }
  
  if ('@graph' in data && Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      if (item['@type'] && articleTypes.includes(item['@type'])) {
        return item;
      }
    }
  }
  
  return null;
}

function extractArticle(forceRefresh = false): ExtractedArticle {
  const currentUrl = window.location.href;
  
  if (!forceRefresh && cachedResult && cachedResult.url === currentUrl) {
    return cachedResult.data;
  }
  processLazyImages();

  const baseUrl = window.location.href;
  const jsonLdData = extractJsonLd();
  const meta = extractMetadata();
  const mergedMeta = {
    title: jsonLdData.title || meta.title,
    author: jsonLdData.author || meta.author,
    publishedAt: jsonLdData.publishedAt || meta.publishedAt,
    topImage: jsonLdData.topImage || meta.topImage,
    description: jsonLdData.description || meta.description,
  };

  let result: ExtractedArticle;

  const adapter = getSiteAdapter(baseUrl);
  if (adapter) {
    const adapterResult = extractWithAdapter(adapter);
    const contentHtml = resolveRelativeUrls(adapterResult.contentHtml, baseUrl);
    const rawDate = adapterResult.publishedAt || mergedMeta.publishedAt;
    
    result = {
      title: adapterResult.title || mergedMeta.title || document.title,
      content_html: contentHtml,
      source_url: baseUrl,
      top_image: mergedMeta.topImage || extractFirstImage(contentHtml),
      author: adapterResult.author || mergedMeta.author,
      published_at: parseDate(rawDate),
      source_domain: new URL(baseUrl).hostname,
      excerpt: mergedMeta.description,
    };
  } else {
    const doc = document.cloneNode(true) as Document;
    const reader = new Readability(doc, {
      charThreshold: 100,
      keepClasses: true,
    });
    const article = reader.parse();

    if (article) {
      const contentHtml = resolveRelativeUrls(article.content, baseUrl);
      const topImage = mergedMeta.topImage || extractFirstImage(contentHtml);
      const rawDate = article.publishedTime || mergedMeta.publishedAt;

      result = {
        title: article.title || mergedMeta.title || document.title,
        content_html: contentHtml,
        source_url: baseUrl,
        top_image: topImage,
        author: article.byline || mergedMeta.author,
        published_at: parseDate(rawDate),
        source_domain: new URL(baseUrl).hostname,
        excerpt: article.excerpt || mergedMeta.description,
      };
    } else {
      const fallbackContent = extractFallbackContent();
      const contentHtml = resolveRelativeUrls(fallbackContent, baseUrl);

      result = {
        title: mergedMeta.title || document.title,
        content_html: contentHtml,
        source_url: baseUrl,
        top_image: mergedMeta.topImage || extractFirstImage(contentHtml),
        author: mergedMeta.author,
        published_at: parseDate(mergedMeta.publishedAt),
        source_domain: new URL(baseUrl).hostname,
        excerpt: mergedMeta.description,
      };
    }
  }

  result.quality = assessContentQuality(result.content_html);
  cachedResult = { url: currentUrl, data: result };
  return result;
}

function assessContentQuality(html: string): ContentQuality {
  const warnings: string[] = [];
  let score = 100;
  
  const textContent = html.replace(/<[^>]*>/g, '');
  const wordCount = textContent.length;
  
  if (wordCount < 200) {
    warnings.push('内容过短，可能提取不完整');
    score -= 30;
  } else if (wordCount < 500) {
    warnings.push('内容较短');
    score -= 10;
  }
  
  if (html.includes('<script') || html.includes('<style')) {
    warnings.push('内容可能包含脚本残留');
    score -= 20;
  }
  
  const imgMatches = html.match(/<img[^>]*>/g) || [];
  const imgCount = imgMatches.length;
  let brokenImgCount = 0;
  
  for (const imgTag of imgMatches) {
    if (imgTag.includes('data:image/gif') || imgTag.includes('data:image/svg+xml')) {
      brokenImgCount++;
    }
  }
  
  if (imgCount > 0 && brokenImgCount > imgCount / 2) {
    warnings.push('部分图片可能未正确加载');
    score -= 15;
  }
  
  const hasCode = html.includes('<pre') || html.includes('<code') || html.includes('```');
  
  return {
    score: Math.max(0, score),
    wordCount,
    hasImages: imgCount > 0,
    hasCode,
    warnings,
  };
}

function processLazyImages(): void {
  document.querySelectorAll('img').forEach((img) => {
    const currentSrc = img.getAttribute('src') || '';
    const shouldReplace = !currentSrc || isPlaceholderSrc(currentSrc);

    if (shouldReplace) {
      for (const attr of LAZY_IMAGE_ATTRS) {
        const lazySrc = img.getAttribute(attr);
        if (lazySrc && !isPlaceholderSrc(lazySrc)) {
          img.setAttribute('src', lazySrc);
          break;
        }
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

  document.querySelectorAll('[data-bg], [data-background-image]').forEach((el) => {
    const lazyBg = el.getAttribute('data-bg') || el.getAttribute('data-background-image');
    if (lazyBg) {
      (el as HTMLElement).style.backgroundImage = `url(${lazyBg})`;
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
      if (el instanceof HTMLTimeElement && el.dateTime) {
        return el.dateTime;
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
      'meta[name="byl"]',
      'meta[name="sailthru.author"]',
      '[itemprop="author"]',
      '[rel="author"]',
      '.author',
      '.byline',
      '.post-author',
      '.entry-author',
    ]),
    publishedAt: getMeta([
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="published_time"]',
      'meta[property="article:published"]',
      'meta[name="date"]',
      'meta[name="DC.date.issued"]',
      'meta[property="og:published_time"]',
      'time[datetime]',
      '[itemprop="datePublished"]',
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
    '.paywall', '.subscription-wall', '.premium-content',
    '.cookie-banner', '.cookie-notice', '.gdpr', '.consent',
    '.popup', '.modal', '.overlay',
    '.sticky-header', '.fixed-header', '.floating-header',
    '.breadcrumb', '.breadcrumbs',
    '.pagination', '.pager',
    '[data-ad]', '[data-advertisement]',
    '.sponsored', '.promotion', '.promo',
    '.print-only',
    '.author-bio', '.author-card', '.author-box',
    '.table-of-contents', '.toc',
    '.feedback', '.rating', '.reactions',
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
