import { ApiClient } from '../../utils/api';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { addToHistory } from '../../utils/history';
import { logError, setupGlobalErrorHandler } from '../../utils/errorLogger';

setupGlobalErrorHandler('editor');

class EditorController {
  #apiClient;
  #articleData = null;
  #categories = [];
  #turndown;

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
  }

  async init() {
    try {
      await this.loadConfig();
      await this.loadArticleData();
      await this.loadCategories();
      await this.setupEventListeners();
      this.setupPreviewToggles();
      this.populateForm();
      this.updateStatus('idle', '准备就绪');
    } catch (error) {
      console.error('Failed to initialize editor:', error);
      logError('editor', error, { action: 'init' });
      this.updateStatus('error', '初始化失败');
    }
  }

  async loadConfig() {
    const apiHost = await ApiClient.loadApiHost();
    this.#apiClient = new ApiClient(apiHost);
  }

  async loadCategories() {
    try {
      this.#categories = await this.#apiClient.getCategories();
      this.populateCategories();
    } catch (error) {
      console.error('Failed to load categories:', error);
      logError('editor', error, { action: 'loadCategories' });
    }
  }

  populateCategories() {
    const select = document.getElementById('categorySelect');
    if (!select) return;

    select.innerHTML = '<option value="">选择分类...</option>';

    this.#categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      if (this.#articleData && this.#articleData.category_id === category.id) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  async loadArticleData() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const articleId = urlParams.get('id');

      if (!articleId) {
        throw new Error('No article ID found');
      }

      return new Promise((resolve, reject) => {
        chrome.storage.local.get([articleId], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (!result[articleId]) {
            reject(new Error('Article data not found'));
          } else {
            this.#articleData = result[articleId];
            
            if (!this.#articleData.content_md && this.#articleData.content_html) {
              this.#articleData.content_md = this.#turndown.turndown(this.#articleData.content_html);
            }
            
            chrome.storage.local.remove([articleId]);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Failed to load article data:', error);
      logError('editor', error, { action: 'loadArticleData' });
      throw error;
    }
  }

  populateForm() {
    if (!this.#articleData) return;

    const titleInput = document.getElementById('titleInput');
    const authorInput = document.getElementById('authorInput');
    const sourceUrlInput = document.getElementById('sourceUrlInput');
    const contentMd = document.getElementById('contentMd');
    const publishedAtInput = document.getElementById('publishedAtInput');
    const mdPreview = document.getElementById('mdPreview');

    if (titleInput) {
      titleInput.value = this.#articleData.title || '';
    }

    if (authorInput) {
      authorInput.value = this.#articleData.author || '';
    }

    if (sourceUrlInput) {
      sourceUrlInput.value = this.#articleData.source_url || '';
    }

    if (contentMd) {
      contentMd.value = this.#articleData.content_md || '';
    }

    if (mdPreview) {
      try {
        const mdContent = this.#articleData.content_md || '';
        if (mdContent.trim()) {
          mdPreview.innerHTML = marked.parse(mdContent);
        } else {
          mdPreview.innerHTML = '<p>无内容</p>';
        }
      } catch (error) {
        console.error('Failed to parse Markdown:', error);
        mdPreview.innerHTML = '<p>Markdown 解析失败</p>';
      }
    }

    if (this.#articleData.top_image) {
      this.setupTopImageSelector(this.#articleData.content_md, this.#articleData.top_image);
    }

    if (publishedAtInput) {
      this.showPublishedAt();
      if (this.#articleData.published_at) {
        const publishedAt = this.normalizeDate(this.#articleData.published_at);
        if (publishedAt) {
          publishedAtInput.value = publishedAt;
        }
      } 
    }
  }

  showPublishedAt() {
    const publishedAtGroup = document.getElementById('publishedAtGroup');

    if (publishedAtGroup) {
      publishedAtGroup.style.display = 'block';
    }
  }

  normalizeDate(dateStr) {
    if (!dateStr) return null;

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;

      const year = date.getFullYear();
      const month = String(date.getMonth() +1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    } catch (error) {
      console.error('Failed to normalize date:', error);
      return null;
    }
  }

  setupTopImageSelector(mdContent, defaultImage) {
    const topImageGroup = document.getElementById('topImageGroup');
    const topImageSelect = document.getElementById('topImageSelect');
    const topImagePreview = document.getElementById('topImagePreview');

    if (!topImageGroup || !topImageSelect || !topImagePreview) return;

    const uniqueImages = new Set();
    const imgRegex = /!\[.*?\]\((.*?)\)/g;
    let match;
    while ((match = imgRegex.exec(mdContent)) !== null) {
      if (match[1]) {
        uniqueImages.add(match[1]);
      }
    }

    if (defaultImage) {
      uniqueImages.add(defaultImage);
    }

    const imageArray = Array.from(uniqueImages);

    imageArray.forEach((imageUrl, index) => {
      const option = document.createElement('option');
      option.value = imageUrl;
      option.textContent = `图片 ${index + 1}`;
      if (imageUrl === defaultImage) {
        option.selected = true;
      }
      topImageSelect.appendChild(option);
    });

    if (imageArray.length > 0) {
      topImageGroup.style.display = 'block';
      this.updateTopImagePreview(defaultImage || imageArray[0]);
    }

    topImageSelect.addEventListener('change', (e) => {
      this.updateTopImagePreview(e.target.value);
    });
  }

  updateTopImagePreview(imageUrl) {
    const topImagePreview = document.getElementById('topImagePreview');
    if (!topImagePreview) return;

    if (imageUrl) {
      topImagePreview.innerHTML = `<img src="${imageUrl}" alt="头图预览" />`;
      topImagePreview.classList.remove('empty');
    } else {
      topImagePreview.innerHTML = '未选择图片';
      topImagePreview.classList.add('empty');
    }
  }

  async setupEventListeners() {
    document.getElementById('submitBtn')?.addEventListener('click', () => this.submitArticle());

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
      window.close();
    });
  }

  setupPreviewToggles() {
    const toggleMdBtn = document.getElementById('toggleMdBtn');
    const contentMd = document.getElementById('contentMd');
    const mdPreview = document.getElementById('mdPreview');

    if (toggleMdBtn && contentMd && mdPreview) {
      toggleMdBtn.addEventListener('click', () => {
        const isEditingMode = !contentMd.classList.contains('hidden');
        if (isEditingMode) {
          try {
            const mdContent = contentMd.value || '';
            if (mdContent.trim()) {
              mdPreview.innerHTML = marked.parse(mdContent);
            } else {
              mdPreview.innerHTML = '<p>无内容</p>';
            }
          } catch (error) {
            console.error('Failed to parse Markdown:', error);
            mdPreview.innerHTML = '<p>Markdown 解析失败</p>';
          }
          contentMd.classList.add('hidden');
          mdPreview.classList.remove('hidden');
          toggleMdBtn.textContent = '编辑';
        } else {
          contentMd.classList.remove('hidden');
          mdPreview.classList.add('hidden');
          toggleMdBtn.textContent = '预览';
        }
      });
    }
  }

  async submitArticle() {
    if (!this.#articleData) {
      this.updateStatus('error', '没有文章数据');
      return;
    }

    const titleInput = document.getElementById('titleInput');
    const authorInput = document.getElementById('authorInput');
    const categorySelect = document.getElementById('categorySelect');
    const contentMd = document.getElementById('contentMd');
    const publishedAtInput = document.getElementById('publishedAtInput');
    const topImageSelect = document.getElementById('topImageSelect');

    const title = titleInput?.value?.trim();
    const author = authorInput?.value?.trim();
    const categoryId = categorySelect?.value;
    const mdContent = contentMd?.value;
    const publishedAt = publishedAtInput?.value || '';
    const topImage = topImageSelect?.value || null;

    if (!title) {
      this.updateStatus('error', '请输入标题');
      return;
    }

    if (!categoryId) {
      this.updateStatus('error', '请选择分类');
      return;
    }

    if (!mdContent) {
      this.updateStatus('error', '请输入文章内容');
      return;
    }

    this.updateStatus('loading', '正在提交文章...');

    try {
      const articleData = {
        title,
        author,
        content_md: mdContent || '',
        source_url: this.#articleData.source_url,
        top_image: topImage,
        published_at: publishedAt,
        source_domain: this.#articleData.source_domain,
        category_id: categoryId,
      };

      const result = await this.#apiClient.createArticle(articleData);

      const category = this.#categories.find(c => c.id === categoryId);
      await addToHistory({
        title: title,
        url: this.#articleData.source_url,
        domain: this.#articleData.source_domain,
        categoryName: category?.name,
      });

      this.updateStatus('success', `提交成功！文章ID: ${result.id}`);

      setTimeout(() => {
        chrome.tabs.create({
          url: `${this.#apiClient.frontendUrl}/article/${result.id}`,
        });
        window.close();
      }, 1000);
    } catch (error) {
      console.error('Failed to submit article:', error);
      logError('editor', error, { action: 'submitArticle', title: this.#articleData?.title });
      const errorMessage = error.message || '提交失败，请重试';
      this.updateStatus('error', errorMessage);
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
  const controller = new EditorController();
  controller.init();
});

export default EditorController;
