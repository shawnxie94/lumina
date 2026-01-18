import { ApiClient } from '../../utils/api';

class EditorController {
  #apiClient;
  #articleData = null;

  constructor() {
    this.#apiClient = new ApiClient();
  }

  async init() {
    try {
      await this.loadConfig();
      await this.loadArticleData();
      await this.setupEventListeners();
      this.populateForm();
      this.updateStatus('idle', '准备就绪');
    } catch (error) {
      console.error('Failed to initialize editor:', error);
      this.updateStatus('error', '初始化失败');
    }
  }

  async loadConfig() {
    const apiHost = await ApiClient.loadApiHost();
    this.#apiClient = new ApiClient(apiHost);
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
            chrome.storage.local.remove([articleId]);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Failed to load article data:', error);
      throw error;
    }
  }

  populateForm() {
    if (!this.#articleData) return;

    const titleInput = document.getElementById('titleInput');
    const authorInput = document.getElementById('authorInput');
    const sourceUrlInput = document.getElementById('sourceUrlInput');
    const contentHtml = document.getElementById('contentHtml');
    const contentMd = document.getElementById('contentMd');

    if (titleInput) {
      titleInput.value = this.#articleData.title || '';
    }

    if (authorInput) {
      authorInput.value = this.#articleData.author || '';
    }

    if (sourceUrlInput) {
      sourceUrlInput.value = this.#articleData.source_url || '';
    }

    if (contentHtml) {
      contentHtml.value = this.#articleData.content_html || '';
    }

    if (contentMd) {
      contentMd.value = this.#articleData.content_md || '';
    }
  }

  async setupEventListeners() {
    document.getElementById('submitBtn')?.addEventListener('click', () => this.submitArticle());

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
      window.close();
    });
  }

  async submitArticle() {
    if (!this.#articleData) {
      this.updateStatus('error', '没有文章数据');
      return;
    }

    const titleInput = document.getElementById('titleInput');
    const authorInput = document.getElementById('authorInput');
    const contentHtml = document.getElementById('contentHtml');
    const contentMd = document.getElementById('contentMd');

    const title = titleInput?.value?.trim();
    const author = authorInput?.value?.trim();
    const htmlContent = contentHtml?.value;
    const mdContent = contentMd?.value;

    if (!title) {
      this.updateStatus('error', '请输入标题');
      return;
    }

    if (!htmlContent && !mdContent) {
      this.updateStatus('error', '请输入文章内容');
      return;
    }

    this.updateStatus('loading', '正在提交文章...');

    try {
      const articleData = {
        title,
        author,
        content_html: htmlContent || '',
        content_md: mdContent || '',
        source_url: this.#articleData.source_url,
        top_image: this.#articleData.top_image,
        published_at: this.#articleData.published_at || '',
        source_domain: this.#articleData.source_domain,
        category_id: this.#articleData.category_id,
      };

      const result = await this.#apiClient.createArticle(articleData);

      this.updateStatus('success', `提交成功！文章ID: ${result.id}`);

      setTimeout(() => {
        chrome.tabs.create({
          url: `${this.#apiClient.frontendUrl}/article/${result.id}`,
        });
        window.close();
      }, 1000);
    } catch (error) {
      console.error('Failed to submit article:', error);
      this.updateStatus('error', '提交失败，请重试');
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
