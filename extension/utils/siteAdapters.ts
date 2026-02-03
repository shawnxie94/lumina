interface SiteAdapter {
  name: string;
  match: (url: string) => boolean;
  getContentSelector: () => string;
  getAuthor: () => string;
  getPublishedAt: () => string;
  getTitle: () => string;
  preProcess?: () => void;
}

// 通用懒加载图片处理
function processLazyImagesForAdapter(): void {
  const lazyAttrs = [
    'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url',
    'data-croporisrc', 'data-actualsrc', 'data-echo', 'data-lazyload',
    'data-hi-res-src', 'data-zoom-src', 'data-full-src',
  ];

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
    if (isPlaceholder(currentSrc)) {
      for (const attr of lazyAttrs) {
        const lazySrc = img.getAttribute(attr);
        if (lazySrc && !isPlaceholder(lazySrc)) {
          img.setAttribute('src', lazySrc);
          break;
        }
      }
    }
  });
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
    processLazyImagesForAdapter();
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

const kr36Adapter: SiteAdapter = {
  name: '36kr',
  match: (url) => url.includes('36kr.com'),
  getContentSelector: () => '.article-content, .common-width',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, .article-author a');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.article-time, time[datetime]');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-title, h1.title');
    return titleEl?.textContent?.trim() || document.title;
  },
  preProcess: processLazyImagesForAdapter,
};

const sspaiAdapter: SiteAdapter = {
  name: 'sspai',
  match: (url) => url.includes('sspai.com'),
  getContentSelector: () => '.article-body, .content',
  getAuthor: () => {
    const authorEl = document.querySelector('.nickname, .author-name');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time[datetime], .date');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
  preProcess: processLazyImagesForAdapter,
};

const segmentfaultAdapter: SiteAdapter = {
  name: 'segmentfault',
  match: (url) => url.includes('segmentfault.com'),
  getContentSelector: () => '.article-content, .fmt',
  getAuthor: () => {
    const authorEl = document.querySelector('.author .name, .user-name');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time[datetime], .article-time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article__title, h1.title');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const cnblogsAdapter: SiteAdapter = {
  name: 'cnblogs',
  match: (url) => url.includes('cnblogs.com'),
  getContentSelector: () => '#cnblogs_post_body, .post-body',
  getAuthor: () => {
    const authorEl = document.querySelector('#Header1_HeaderTitle, .author a');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('#post-date, .postDesc span');
    return timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('#cb_post_title_url, .postTitle a');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const jianshuAdapter: SiteAdapter = {
  name: 'jianshu',
  match: (url) => url.includes('jianshu.com'),
  getContentSelector: () => 'article, .article',
  getAuthor: () => {
    const authorEl = document.querySelector('.name, ._22gUMi');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time, .publish-time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('h1, ._1RuRku');
    return titleEl?.textContent?.trim() || document.title;
  },
  preProcess: processLazyImagesForAdapter,
};

const oschinaAdapter: SiteAdapter = {
  name: 'oschina',
  match: (url) => url.includes('oschina.net'),
  getContentSelector: () => '.article-detail, .content',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, .user-info .name');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.publish-time, time');
    return timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-box__title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const huxiuAdapter: SiteAdapter = {
  name: 'huxiu',
  match: (url) => url.includes('huxiu.com'),
  getContentSelector: () => '.article-content, .article__content',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, .article-author');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.article-time, time');
    return timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
  preProcess: processLazyImagesForAdapter,
};

const geekparkAdapter: SiteAdapter = {
  name: 'geekpark',
  match: (url) => url.includes('geekpark.net'),
  getContentSelector: () => '.article-content, .post-content',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, .article-author');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('.publish-time, time');
    return timeEl?.textContent?.trim() || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('.article-title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const substackAdapter: SiteAdapter = {
  name: 'substack',
  match: (url) => url.includes('substack.com') || document.querySelector('meta[property="og:site_name"][content*="Substack"]') !== null,
  getContentSelector: () => '.body, .post-content, article',
  getAuthor: () => {
    const authorMeta = document.querySelector('meta[name="author"]');
    if (authorMeta) return authorMeta.getAttribute('content') || '';
    const authorEl = document.querySelector('.author-name, .byline-names');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeMeta = document.querySelector('meta[property="article:published_time"]');
    if (timeMeta) return timeMeta.getAttribute('content') || '';
    const timeEl = document.querySelector('time[datetime]');
    return timeEl?.getAttribute('datetime') || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('h1.post-title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const devtoAdapter: SiteAdapter = {
  name: 'devto',
  match: (url) => url.includes('dev.to'),
  getContentSelector: () => '#article-body, .crayons-article__body',
  getAuthor: () => {
    const authorEl = document.querySelector('.crayons-article__subheader a, .author-name');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time[datetime]');
    return timeEl?.getAttribute('datetime') || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('#main-title, h1');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const hashnodeAdapter: SiteAdapter = {
  name: 'hashnode',
  match: (url) => url.includes('hashnode.dev') || url.includes('hashnode.com'),
  getContentSelector: () => '.prose, article',
  getAuthor: () => {
    const authorEl = document.querySelector('.author-name, [data-testid="author-name"]');
    return authorEl?.textContent?.trim() || '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time[datetime]');
    return timeEl?.getAttribute('datetime') || '';
  },
  getTitle: () => {
    const titleEl = document.querySelector('h1');
    return titleEl?.textContent?.trim() || document.title;
  },
};

const notionAdapter: SiteAdapter = {
  name: 'notion',
  match: (url) => url.includes('notion.site') || url.includes('notion.so'),
  getContentSelector: () => '.notion-page-content, [class*="notion-page-content"]',
  getAuthor: () => '',
  getPublishedAt: () => '',
  getTitle: () => {
    const titleEl = document.querySelector('.notion-page-block h1, [class*="notion-header-block"]');
    return titleEl?.textContent?.trim() || document.title;
  },
  preProcess: processLazyImagesForAdapter,
};

const twitterAdapter: SiteAdapter = {
  name: 'twitter',
  match: (url) => url.includes('twitter.com') || url.includes('x.com'),
  getContentSelector: () => '[data-testid="tweetText"], article[data-testid="tweet"]',
  getAuthor: () => {
    const authorEl = document.querySelector('[data-testid="User-Name"] a, [data-testid="UserName"]');
    if (authorEl) {
      const displayName = authorEl.textContent?.trim() || '';
      return displayName;
    }
    const metaAuthor = document.querySelector('meta[property="og:title"]');
    if (metaAuthor) {
      const content = metaAuthor.getAttribute('content') || '';
      const match = content.match(/^(.+?)\s+on\s+(?:X|Twitter)/i);
      if (match) return match[1];
    }
    return '';
  },
  getPublishedAt: () => {
    const timeEl = document.querySelector('time[datetime]');
    return timeEl?.getAttribute('datetime') || '';
  },
  getTitle: () => {
    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) {
      return metaTitle.getAttribute('content') || document.title;
    }
    return document.title;
  },
  preProcess: () => {
    processLazyImagesForAdapter();
    document.querySelectorAll('[data-testid="card.wrapper"]').forEach((card) => {
      const link = card.querySelector('a[href]');
      if (link) {
        const href = link.getAttribute('href');
        if (href && !href.includes('twitter.com') && !href.includes('x.com')) {
          const linkText = document.createElement('p');
          linkText.innerHTML = `<a href="${href}">${href}</a>`;
          card.appendChild(linkText);
        }
      }
    });
  },
};

const adapters: SiteAdapter[] = [
  weixinAdapter,
  zhihuAdapter,
  mediumAdapter,
  juejinAdapter,
  csdnAdapter,
  infoqAdapter,
  kr36Adapter,
  sspaiAdapter,
  segmentfaultAdapter,
  cnblogsAdapter,
  jianshuAdapter,
  oschinaAdapter,
  huxiuAdapter,
  geekparkAdapter,
  substackAdapter,
  devtoAdapter,
  hashnodeAdapter,
  notionAdapter,
  twitterAdapter,
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
