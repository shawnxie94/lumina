import type { ExtractedContent } from '../types';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

/**
 * Extract article content from the current page
 */
export function extractContent(): ExtractedContent {
  const doc = document.cloneNode(true) as Document;
  const article = new Readability(doc).parse();

  if (!article) {
    return {
      title: document.title,
      content_html: document.body?.innerHTML || '',
      content_md: '',
      source_url: window.location.href,
      top_image: null,
      author: '',
      published_at: '',
      source_domain: new URL(window.location.href).hostname,
    };
  }

  const turndownService = new TurndownService();
  const contentMd = turndownService.turndown(article.content);
  const topImage = extractTopImage(article.content);

  return {
    title: article.title,
    content_html: article.content,
    content_md: contentMd,
    source_url: window.location.href,
    top_image: topImage,
    author: article.byline || '',
    published_at: article.publishedTime || '',
    source_domain: new URL(window.location.href).hostname,
  };
}

/**
 * Extract the first image from HTML content
 */
export function extractTopImage(content: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const img = doc.querySelector('img');

  if (img && img.src) {
    return img.src;
  }

  return null;
}
