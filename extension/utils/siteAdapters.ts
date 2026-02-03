interface SiteAdapter {
  name: string;
  match: (url: string) => boolean;
  getContentSelector: () => string;
  getAuthor: () => string;
  getPublishedAt: () => string;
  getTitle: () => string;
  preProcess?: () => void;
}

const weixinAdapter: SiteAdapter = {
  name: 'weixin',
  match: (url) => url.includes('mp.weixin.qq.com'),
  getContentSelector: () => '#js_content',
  getAuthor: () => {
    const accountName = document.getElementById('js_name')?.textContent?.trim();
    const author = document.getElementById('js_author_name')?.textContent?.trim();
    return author || accountName || '';
  },
  getPublishedAt: () => {
    const publishTime = document.getElementById('publish_time')?.textContent?.trim();
    if (publishTime) return publishTime;
    
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const match = script.textContent?.match(/var\s+ct\s*=\s*"(\d+)"/);
      if (match) {
        return new Date(parseInt(match[1]) * 1000).toISOString();
      }
    }
    return '';
  },
  getTitle: () => {
    return document.getElementById('activity-name')?.textContent?.trim() || document.title;
  },
  preProcess: () => {
    document.querySelectorAll('img[data-src]').forEach((img) => {
      const dataSrc = img.getAttribute('data-src');
      if (dataSrc) {
        img.setAttribute('src', dataSrc);
      }
    });
    document.querySelectorAll('img[data-croporisrc]').forEach((img) => {
      const cropSrc = img.getAttribute('data-croporisrc');
      if (cropSrc) {
        img.setAttribute('src', cropSrc);
      }
    });
  },
};

const zhihuAdapter: SiteAdapter = {
  name: 'zhihu',
  match: (url) => url.includes('zhihu.com'),
  getContentSelector: () => {
    if (window.location.pathname.includes('/p/')) {
      return '.Post-RichText';
    }
    if (window.location.pathname.includes('/answer/')) {
      return '.AnswerItem .RichContent-inner';
    }
    return '.RichText';
  },
  getAuthor: () => {
    const authorLink = document.querySelector('.AuthorInfo-name a, .UserLink-link');
    return authorLink?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.ContentItem-time');
    const timeText = timeEl?.textContent?.trim() || '';
    const match = timeText.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  },
  getTitle: () => {
    const postTitle = document.querySelector('.Post-Title');
    if (postTitle) return postTitle.textContent?.trim() || '';
    
    const questionTitle = document.querySelector('.QuestionHeader-title');
    return questionTitle?.textContent?.trim() || document.title;
  },
};

const mediumAdapter: SiteAdapter = {
  name: 'medium',
  match: (url) => url.includes('medium.com') || document.querySelector('meta[property="al:android:app_name"][content="Medium"]') !== null,
  getContentSelector: () => 'article',
  getAuthor: () => {
    const authorMeta = document.querySelector('meta[name="author"]');
    if (authorMeta) return authorMeta.getAttribute('content') || '';
    
    const authorLink = document.querySelector('a[rel="author"]');
    return authorLink?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeMeta = document.querySelector('meta[property="article:published_time"]');
    if (timeMeta) return timeMeta.getAttribute('content') || '';
    
    const timeEl = document.querySelector('time');
    return timeEl?.getAttribute('datetime') || '';
  },
  getTitle: () => {
    const h1 = document.querySelector('article h1');
    return h1?.textContent?.trim() || document.title;
  },
};

const juejinAdapter: SiteAdapter = {
  name: 'juejin',
  match: (url) => url.includes('juejin.cn'),
  getContentSelector: () => '.article-content, .markdown-body',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name a, .username');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.meta-box time, .article-meta time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-title');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const csdnAdapter: SiteAdapter = {
  name: 'csdn',
  match: (url) => url.includes('blog.csdn.net'),
  getContentSelector: () => '#content_views, .article_content',
  getAuthor: () => {
    const authorEl = document.querySelector('.follow-nickName, .profile-intro-name-boxTop a');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.time');
    return timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.title-article');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const infoqAdapter: SiteAdapter = {
  name: 'infoq',
  match: (url) => url.includes('infoq.cn') || url.includes('infoq.com'),
  getContentSelector: () => '.article-content, .article-preview',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, .article-author');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.date, .article-time');
    return timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-title h1, .article-preview-title');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const adapters: SiteAdapter[] = [
  weixinAdapter,
  zhihuAdapter,
  mediumAdapter,
  juejinAdapter,
  csdnAdapter,
  infoqAdapter,
];

export function getSiteAdapter(url: string): SiteAdapter | null {
  for (const adapter of adapters) {
    if (adapter.match(url)) {
      return adapter;
    }
  }
  return null;
}

export function extractWithAdapter(adapter: SiteAdapter): {
  title: string;
  author: string;
  publishedAt: string;
  contentHtml: string;
} {
  if (adapter.preProcess) {
    adapter.preProcess();
  }

  const contentSelector = adapter.getContentSelector();
  const contentEl = document.querySelector(contentSelector);
  
  let contentHtml = '';
  if (contentEl) {
    const clone = contentEl.cloneNode(true) as Element;
    const removeSelectors = [
      'script', 'style', 'noscript',
      '.comment', '.comments', '.share', '.social',
      '.recommend', '.related', '.ad', '.ads',
    ];
    removeSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((el) => el.remove());
    });
    contentHtml = clone.innerHTML;
  }

  return {
    title: adapter.getTitle(),
    author: adapter.getAuthor(),
    publishedAt: adapter.getPublishedAt(),
    contentHtml,
  };
}

export type { SiteAdapter };
