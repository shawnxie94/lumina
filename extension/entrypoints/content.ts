import { defineContentScript } from 'wxt/sandbox';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'extractArticle') {
        try {
          const doc = document.cloneNode(true);
          const article = new Readability(doc).parse();

          let result;
          if (!article) {
            result = {
              title: document.title,
              content_html: document.body?.innerHTML || '',
              content_md: '',
              source_url: window.location.href,
              top_image: null,
              author: '',
              published_at: '',
              source_domain: new URL(window.location.href).hostname,
            };
          } else {
            const turndownService = new TurndownService();
            const contentMd = turndownService.turndown(article.content);
            const topImage = extractTopImage(article.content);

            result = {
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

          sendResponse({ success: true, data: result });
        } catch (error) {
          console.error('Extract error:', error);
          sendResponse({ success: false, error: error.message });
        }
      }

      return true;
    });

    function extractTopImage(content) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      const img = doc.querySelector('img');

      if (img && img.src) {
        return img.src;
      }

      return null;
    }
  },
});
