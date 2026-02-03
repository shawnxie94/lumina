import '../../styles/popup.css';
import { ApiClient, DEFAULT_CATEGORIES } from '../../utils/api';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

class PopupController {
  #apiClient;
  #turndown;
  #articleData = null;
  #currentTab = null;

  constructor() {
    this.#apiClient = new ApiClient();
    this.#turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });
    
    this.#turndown.use(gfm);
    this.#turndown.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside']);
    
    this.#turndown.addRule('fencedCodeBlockWithLanguage', {
      filter: (node, options) => {
        return (
          options.codeBlockStyle === 'fenced' &&
          node.nodeName === 'PRE' &&
          node.firstChild &&
          node.firstChild.nodeName === 'CODE'
        );
      },
      replacement: (_content, node, options) => {
        const codeNode = node.firstChild;
        const className = codeNode.getAttribute('class') || '';
        const langMatch = className.match(/(?:language-|lang-)(\w+)/);
        const language = langMatch ? langMatch[1] : '';
        const code = codeNode.textContent || '';
        const fence = options.fence;
        return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`;
      },
    });

    this.#turndown.addRule('mathBlock', {
      filter: (node) => {
        if (node.nodeName === 'DIV' || node.nodeName === 'SPAN') {
          const className = node.className || '';
          if (className.match(/MathJax|mathjax|katex|math-display|math-block/i)) {
            return true;
          }
        }
        if (node.nodeName === 'SCRIPT' && node.getAttribute('type')?.includes('math/tex')) {
          return true;
        }
        if (node.nodeName === 'MATH') {
          return true;
        }
        return false;
      },
      replacement: (_content, node) => {
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation?.textContent) {
          const tex = annotation.textContent.trim();
          const isBlock = node.nodeName === 'DIV' || 
                         node.className?.includes('display') ||
                         node.className?.includes('block');
          return isBlock ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
        }
        
        if (node.nodeName === 'SCRIPT') {
          const tex = node.textContent?.trim() || '';
          const isDisplay = node.getAttribute('type')?.includes('display');
          return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
        }

        const altText = node.getAttribute('alt') || node.getAttribute('data-formula');
        if (altText) {
          const isBlock = node.nodeName === 'DIV' || 
                         node.className?.includes('display') ||
                         node.className?.includes('block');
          return isBlock ? `\n\n$$\n${altText}\n$$\n\n` : `$${altText}$`;
        }

        return _content;
      },
    });

    this.#turndown.addRule('mathImg', {
      filter: (node) => {
        if (node.nodeName === 'IMG') {
          const alt = node.getAttribute('alt') || '';
          const src = node.getAttribute('src') || '';
          const className = node.className || '';
          return alt.includes('\\') || 
                 src.includes('latex') || 
                 src.includes('codecogs') ||
                 src.includes('math') ||
                 className.includes('math') ||
                 className.includes('latex');
        }
        return false;
      },
      replacement: (_content, node) => {
        const alt = node.getAttribute('alt') || '';
        if (alt && alt.includes('\\')) {
          return `$${alt}$`;
        }
        const src = node.getAttribute('src') || '';
        const texMatch = src.match(/[?&]tex=([^&]+)/);
        if (texMatch) {
          return `$${decodeURIComponent(texMatch[1])}$`;
        }
        return `![math](${src})`;
      },
    });

    this.#turndown.addRule('videoEmbed', {
      filter: (node) => {
        if (node.nodeName === 'IFRAME') {
          const src = node.getAttribute('src') || '';
          return src.includes('youtube.com') ||
                 src.includes('youtu.be') ||
                 src.includes('bilibili.com') ||
                 src.includes('vimeo.com') ||
                 src.includes('player.bilibili.com');
        }
        if (node.nodeName === 'VIDEO') {
          return true;
        }
        return false;
      },
      replacement: (_content, node) => {
        const src = node.getAttribute('src') || '';
        const title = node.getAttribute('title') || 'Video';
        
        let videoUrl = src;
        let videoId = '';

        const youtubeMatch = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([^?&]+)/);
        if (youtubeMatch) {
          videoId = youtubeMatch[1];
          videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          return `\n\n[▶ ${title}](${videoUrl})\n\n`;
        }

        const bilibiliMatch = src.match(/player\.bilibili\.com\/player\.html\?.*?(?:bvid=|aid=)([^&]+)/);
        if (bilibiliMatch) {
          videoId = bilibiliMatch[1];
          videoUrl = `https://www.bilibili.com/video/${videoId}`;
          return `\n\n[▶ ${title}](${videoUrl})\n\n`;
        }

        const vimeoMatch = src.match(/player\.vimeo\.com\/video\/(\d+)/);
        if (vimeoMatch) {
          videoId = vimeoMatch[1];
          videoUrl = `https://vimeo.com/${videoId}`;
          return `\n\n[▶ ${title}](${videoUrl})\n\n`;
        }

        if (node.nodeName === 'VIDEO') {
          const videoSrc = node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || '';
          if (videoSrc) {
            return `\n\n[▶ Video](${videoSrc})\n\n`;
          }
        }

        return `\n\n[▶ ${title}](${src})\n\n`;
      },
    });

    this.#turndown.addRule('improvedImage', {
      filter: 'img',
      replacement: (_content, node) => {
        let src = node.getAttribute('src') || '';
        
        const isPlaceholder = (s) => {
          if (!s) return true;
          if (s.startsWith('data:image/svg+xml')) return true;
          if (s.startsWith('data:image/gif;base64,R0lGOD')) return true;
          if (s.includes('1x1') || s.includes('placeholder') || s.includes('blank')) return true;
          if (s.includes('spacer') || s.includes('loading')) return true;
          return false;
        };

        if (isPlaceholder(src)) {
          src = node.getAttribute('data-src') || 
                node.getAttribute('data-original') ||
                node.getAttribute('data-lazy-src') ||
                node.getAttribute('data-croporisrc') || '';
        }

        if (!src || isPlaceholder(src)) return '';

        let alt = node.getAttribute('alt') || '';
        
        if (!alt || alt === 'image' || alt === 'img' || alt === '图片' || alt.length < 2) {
          alt = node.getAttribute('title') ||
                node.getAttribute('data-alt') ||
                node.getAttribute('aria-label') ||
                '';
        }

        if (!alt) {
          const figcaption = node.closest('figure')?.querySelector('figcaption');
          if (figcaption) {
            alt = figcaption.textContent?.trim() || '';
          }
        }

        if (!alt) {
          const filename = src.split('/').pop()?.split('?')[0] || '';
          const nameWithoutExt = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
          if (nameWithoutExt && nameWithoutExt.length > 2 && nameWithoutExt.length < 50) {
            alt = nameWithoutExt;
          }
        }

        alt = alt.replace(/[\[\]]/g, '').trim();
        
        const title = node.getAttribute('title');
        const titlePart = title && title !== alt ? ` "${title}"` : '';
        
        return `![${alt}](${src}${titlePart})`;
      },
    });

    this.#turndown.addRule('nestedBlockquote', {
      filter: 'blockquote',
      replacement: (content, node) => {
        let depth = 0;
        let parent = node.parentNode;
        while (parent) {
          if (parent.nodeName === 'BLOCKQUOTE') {
            depth++;
          }
          parent = parent.parentNode;
        }

        const prefix = '> '.repeat(depth + 1);
        const lines = content.trim().split('\n');
        const quotedLines = lines.map(line => {
          if (line.trim() === '') return prefix.trim();
          if (line.startsWith('>')) return prefix + line;
          return prefix + line;
        });

        return '\n\n' + quotedLines.join('\n') + '\n\n';
      },
    });
  }

  async init() {
    try {
      await this.loadConfig();
      await this.setupEventListeners();
      await this.loadCategories();
      await this.extractArticle();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.updateStatus('error', '初始化失败');
    }
  }

  async loadConfig() {
    const apiHost = await ApiClient.loadApiHost();
    this.#apiClient = new ApiClient(apiHost);

    const apiHostInput = document.getElementById('apiHostInput');
    if (apiHostInput) {
      apiHostInput.value = apiHost;
    }
  }

  async setupEventListeners() {
    document.getElementById('closeBtn')?.addEventListener('click', () => {
      window.close();
    });

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
      window.close();
    });

    document.getElementById('collectBtn')?.addEventListener('click', () => this.collectArticle());

    document.getElementById('editAndCollectBtn')?.addEventListener('click', () => this.openEditorPage());

    document.getElementById('configBtn')?.addEventListener('click', () => this.openConfigModal());

    document.getElementById('saveConfigBtn')?.addEventListener('click', () => this.saveConfig());

    document.getElementById('cancelConfigBtn')?.addEventListener('click', () => this.closeConfigModal());

    document.getElementById('retryBtn')?.addEventListener('click', () => this.retryExtract());
  }

  async retryExtract() {
    this.hideRetryButton();
    if (this.#currentTab?.id) {
      try {
        await chrome.tabs.sendMessage(this.#currentTab.id, { type: 'EXTRACT_ARTICLE', forceRefresh: true });
      } catch {
        // Ignore, will use fallback
      }
    }
    await this.extractArticle();
  }

  showRetryButton() {
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.classList.remove('hidden');
    }
  }

  hideRetryButton() {
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.classList.add('hidden');
    }
  }

  async loadCategories() {
    try {
      const categories = await this.#apiClient.getCategories();
      this.populateCategories(categories);
    } catch (error) {
      console.error('Failed to load categories:', error);
      this.updateStatus('warning', '加载分类失败，使用默认分类');
      this.populateCategories(DEFAULT_CATEGORIES);
    }
  }

  populateCategories(categories) {
    const select = document.getElementById('categorySelect');
    if (!select) return;

    select.innerHTML = '<option value="">选择分类...</option>';

    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    });

    if (categories.length > 0) {
      select.value = categories[0].id;
    }
  }

  async extractArticle() {
    this.updateStatus('loading', '正在连接页面...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.#currentTab = tab;

      if (!tab.id) {
        this.updateStatus('error', '无法获取当前标签页');
        return;
      }

      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        this.updateStatus('error', '无法在此页面提取内容');
        return;
      }

      this.updateStatus('loading', '正在提取文章内容...');

      let extractedData;
      
      try {
        extractedData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
      } catch {
        this.updateStatus('loading', '正在使用备用方式提取...');
        extractedData = await this.extractViaScript(tab.id);
      }

      if (!extractedData || !extractedData.content_html) {
        this.updateStatus('error', '未能提取到文章内容，请确认页面已加载完成');
        return;
      }

      this.updateStatus('loading', '正在转换为 Markdown...');

      const contentMd = this.#turndown.turndown(extractedData.content_html);

      this.#articleData = {
        ...extractedData,
        content_md: contentMd,
      };

      const previewTitle = document.getElementById('previewTitle');
      if (previewTitle && this.#articleData) {
        previewTitle.textContent = this.#articleData.title || '(无标题)';
      }

      const wordCount = contentMd.length;
      const readingTime = Math.ceil(wordCount / 500);
      this.updateStatus('idle', `准备就绪 · 约 ${readingTime} 分钟阅读`);
    } catch (error) {
      console.error('Failed to extract article:', error);
      this.handleExtractionError(error);
    }
  }

  handleExtractionError(error) {
    const message = error?.message || String(error);
    
    if (message.includes('Cannot access') || message.includes('not allowed')) {
      this.updateStatus('error', '无权限访问此页面');
    } else if (message.includes('No tab') || message.includes('No active')) {
      this.updateStatus('error', '无法获取当前标签页');
    } else if (message.includes('connection') || message.includes('Receiving end')) {
      this.updateStatus('error', '页面连接失败，请刷新页面后重试');
      this.showRetryButton();
    } else {
      this.updateStatus('error', '提取失败，请刷新页面后重试');
      this.showRetryButton();
    }
  }

  async extractViaScript(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const lazyAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-croporisrc'];
        const isPlaceholder = (s) => {
          if (!s) return true;
          if (s.startsWith('data:image/svg+xml')) return true;
          if (s.startsWith('data:image/gif;base64,R0lGOD')) return true;
          if (s.includes('1x1') || s.includes('placeholder') || s.includes('blank')) return true;
          return false;
        };
        document.querySelectorAll('img').forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (isPlaceholder(src)) {
            for (const attr of lazyAttrs) {
              const lazySrc = img.getAttribute(attr);
              if (lazySrc) {
                img.setAttribute('src', lazySrc);
                break;
              }
            }
          }
        });

        const getMeta = (selectors) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el?.content) return el.content;
            if (el?.textContent) return el.textContent.trim();
          }
          return '';
        };

        const title = getMeta(['meta[property="og:title"]', 'meta[name="twitter:title"]']) || document.title;
        const author = getMeta(['meta[name="author"]', 'meta[property="article:author"]', '.author', '.byline']);
        const publishedAt = getMeta(['meta[property="article:published_time"]', 'meta[name="date"]', 'time[datetime]']);
        const topImage = getMeta(['meta[property="og:image"]', 'meta[name="twitter:image"]']);

        const selectorsToTry = ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.content', '#content'];
        let articleElement = null;
        for (const selector of selectorsToTry) {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim().length > 200) {
            articleElement = el;
            break;
          }
        }
        if (!articleElement) articleElement = document.body;

        const clone = articleElement.cloneNode(true);
        ['script', 'style', 'noscript', 'nav', 'footer', 'aside', '.ads', '.comments', '.share', '.related'].forEach(sel => {
          clone.querySelectorAll(sel).forEach(el => el.remove());
        });

        return {
          title,
          content_html: clone.innerHTML,
          source_url: window.location.href,
          top_image: topImage || clone.querySelector('img')?.src || null,
          author,
          published_at: publishedAt,
          source_domain: new URL(window.location.href).hostname,
          excerpt: getMeta(['meta[property="og:description"]', 'meta[name="description"]']),
        };
      },
    });
    return results[0].result;
  }

  extractTopImage(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const img = doc.querySelector('img');

    if (img && img.src) {
      return img.src;
    }

    return null;
  }

  async convertImageToBase64(imageUrl) {
    if (!imageUrl) return null;

    try {
      if (imageUrl.startsWith('data:')) {
        return imageUrl;
      }

      const response = await fetch(imageUrl, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
      });

      if (!response.ok) {
        console.warn('Failed to fetch image:', imageUrl, response.status);
        return imageUrl;
      }

      const blob = await response.blob();

      const MAX_SIZE = 2 * 1024 * 1024;
      if (blob.size > MAX_SIZE) {
        console.warn('Image too large, skipping conversion:', blob.size);
        return imageUrl;
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('Failed to convert image to base64:', error);
      return imageUrl;
    }
  }

  async collectArticle() {
    const categoryIdSelect = document.getElementById('categorySelect');
    const categoryId = categoryIdSelect?.value;

    if (!categoryId) {
      this.updateStatus('error', '请选择分类');
      return;
    }

    if (!this.#articleData) {
      this.updateStatus('error', '没有文章数据');
      return;
    }

    this.updateStatus('loading', '正在上传文章...');

    try {
      const topImageBase64 = await this.convertImageToBase64(this.#articleData.top_image);

      const result = await this.#apiClient.createArticle({
        title: this.#articleData.title,
        content_md: this.#articleData.content_md,
        source_url: this.#articleData.source_url,
        top_image: topImageBase64,
        author: this.#articleData.author,
        published_at: this.#articleData.published_at,
        source_domain: this.#articleData.source_domain,
        category_id: categoryId,
      });

      this.updateStatus('success', `采集成功！文章ID: ${result.id}`);
      this.showSuccessButtons(result.id);
    } catch (error) {
      console.error('Failed to collect article:', error);
      this.updateStatus('error', '采集失败，请重试');
    }
  }

  async openEditorPage() {
    const categoryIdSelect = document.getElementById('categorySelect');
    const categoryId = categoryIdSelect?.value;

    if (!categoryId) {
      this.updateStatus('error', '请选择分类');
      return;
    }

    if (!this.#articleData) {
      this.updateStatus('error', '没有文章数据');
      return;
    }

    try {
      const articleData = {
        ...this.#articleData,
        category_id: categoryId,
      };

      const articleId = `editor_${Date.now()}`;

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [articleId]: articleData }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      const editorUrl = `${chrome.runtime.getURL('editor.html')}?id=${articleId}`;

      chrome.tabs.create({ url: editorUrl });
      window.close();
    } catch (error) {
      console.error('Failed to open editor:', error);
      this.updateStatus('error', '打开编辑页面失败');
    }
  }

  showSuccessButtons(articleId) {
    const buttonsDiv = document.querySelector('.buttons');
    if (!buttonsDiv) return;

    buttonsDiv.innerHTML = '';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-primary';
    editBtn.textContent = '编辑文章';
    editBtn.onclick = () => {
      chrome.tabs.create({
        url: `${this.#apiClient.frontendUrl}/article/${articleId}`,
      });
      window.close();
    };
    buttonsDiv.appendChild(editBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = '关闭';
    closeBtn.onclick = () => window.close();
    buttonsDiv.appendChild(closeBtn);
  }

  openConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) {
      modal.classList.add('show');
    }
  }

  closeConfigModal() {
    const modal = document.getElementById('configModal');
    if (modal) {
      modal.classList.remove('show');
    }
  }

  async saveConfig() {
    const apiHostInput = document.getElementById('apiHostInput');
    const newApiHost = apiHostInput?.value.trim();

    if (!newApiHost) {
      alert('请输入有效的 API 地址');
      return;
    }

    try {
      await ApiClient.saveApiHost(newApiHost);
      alert('配置已保存，页面将重新加载');
      this.closeConfigModal();
      location.reload();
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('保存配置失败');
    }
  }

  updateStatus(type, message) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.className = `status ${type}`;
      statusEl.textContent = message;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  controller.init();
});

export default PopupController;
