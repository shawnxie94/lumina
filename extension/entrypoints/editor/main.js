import { ApiClient } from '../../utils/api';
import { marked } from 'marked';

class EditorController {
  #apiClient;
  #articleData = null;

  constructor() {
    this.#apiClient = new ApiClient();
    this.setupPreviewToggles();
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
    const publishedAtInput = document.getElementById('publishedAtInput');

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

    if (this.#articleData.top_image) {
      this.showTopImage(this.#articleData.top_image);
    }

    if (this.#articleData.published_at) {
      this.showPublishedAt(this.#articleData.published_at);
    }

    if (publishedAtInput) {
      publishedAtInput.value = this.#articleData.published_at || '';
    }
  }

  showTopImage(imageUrl) {
    const topImageGroup = document.getElementById('topImageGroup');
    const topImagePreview = document.getElementById('topImagePreview');

    if (topImageGroup && topImagePreview) {
      topImageGroup.style.display = 'block';
      topImagePreview.innerHTML = `<img src="${imageUrl}" alt="头图" />`;
    }
  }

  showPublishedAt(publishedAt) {
    const publishedAtGroup = document.getElementById('publishedAtGroup');

    if (publishedAtGroup) {
      publishedAtGroup.style.display = 'block';
    }
  }

  async setupEventListeners() {
    document.getElementById('submitBtn')?.addEventListener('click', () => this.submitArticle());

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
      window.close();
    });
  }

  setupPreviewToggles() {
    const toggleHtmlBtn = document.getElementById('toggleHtmlBtn');
    const previewHtmlBtn = document.getElementById('previewHtmlBtn');
    const toggleMdBtn = document.getElementById('toggleMdBtn');
    const previewMdBtn = document.getElementById('previewMdBtn');
    const contentHtml = document.getElementById('contentHtml');
    const contentMd = document.getElementById('contentMd');
    const htmlPreview = document.getElementById('htmlPreview');
    const mdPreview = document.getElementById('mdPreview');

    if (toggleHtmlBtn && contentHtml) {
      toggleHtmlBtn.addEventListener('click', () => {
        const isCollapsed = toggleHtmlBtn.getAttribute('data-collapsed') === 'true';
        if (isCollapsed) {
          contentHtml.classList.remove('hidden');
          toggleHtmlBtn.setAttribute('data-collapsed', 'false');
          toggleHtmlBtn.textContent = '折叠';
        } else {
          contentHtml.classList.add('hidden');
          toggleHtmlBtn.setAttribute('data-collapsed', 'true');
          toggleHtmlBtn.textContent = '展开';
        }
      });
    }

    if (toggleMdBtn && contentMd) {
      toggleMdBtn.addEventListener('click', () => {
        const isCollapsed = toggleMdBtn.getAttribute('data-collapsed') === 'true';
        if (isCollapsed) {
          contentMd.classList.remove('hidden');
          toggleMdBtn.setAttribute('data-collapsed', 'false');
          toggleMdBtn.textContent = '折叠';
        } else {
          contentMd.classList.add('hidden');
          toggleMdBtn.setAttribute('data-collapsed', 'true');
          toggleMdBtn.textContent = '展开';
        }
      });
    }

    if (previewHtmlBtn && htmlPreview && contentHtml) {
      previewHtmlBtn.addEventListener('click', () => {
        const isHidden = htmlPreview.classList.contains('hidden');
        if (isHidden) {
          htmlPreview.innerHTML = contentHtml.value || '<p>无内容</p>';
          htmlPreview.classList.remove('hidden');
          previewHtmlBtn.textContent = '关闭预览';
        } else {
          htmlPreview.classList.add('hidden');
          previewHtmlBtn.textContent = '预览';
        }
      });
    }

    if (previewMdBtn && mdPreview && contentMd) {
      previewMdBtn.addEventListener('click', () => {
        const isHidden = mdPreview.classList.contains('hidden');
        if (isHidden) {
          try {
            const mdContent = contentMd.value || '';
            if (mdContent.trim()) {
              mdPreview.innerHTML = marked.parse(mdContent);
            } else {
              mdPreview.innerHTML = '<p>无内容</p>';
            }
            mdPreview.classList.remove('hidden');
            previewMdBtn.textContent = '关闭预览';
          } catch (error) {
            console.error('Failed to parse Markdown:', error);
            mdPreview.innerHTML = '<p>Markdown 解析失败</p>';
            mdPreview.classList.remove('hidden');
            previewMdBtn.textContent = '关闭预览';
          }
        } else {
          mdPreview.classList.add('hidden');
          previewMdBtn.textContent = '预览';
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
