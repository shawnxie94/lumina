import '../../styles/popup.css';
import { ApiClient, DEFAULT_CATEGORIES } from '../../utils/api';

class PopupController {
  #apiClient;
  #articleData = null;
  #currentTab = null;

  constructor() {
    this.#apiClient = new ApiClient();
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

    document.getElementById('configBtn')?.addEventListener('click', () => this.openConfigModal());

    document.getElementById('saveConfigBtn')?.addEventListener('click', () => this.saveConfig());

    document.getElementById('cancelConfigBtn')?.addEventListener('click', () => this.closeConfigModal());
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
  }

  async extractArticle() {
    this.updateStatus('loading', '正在提取文章内容...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.#currentTab = tab;

      if (!tab.id) {
        throw new Error('No active tab found');
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const doc = document.cloneNode(true);
          const title = document.title;
          const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
          const metaAuthor = document.querySelector('meta[name="author"]')?.content || '';

          const articleElement = document.querySelector('article') ||
                                document.querySelector('[role="main"]') ||
                                document.querySelector('main') ||
                                document.querySelector('.content') ||
                                document.body;

          const content = articleElement?.innerHTML || document.body?.innerHTML || '';

          const img = articleElement?.querySelector('img');
          const topImage = img?.src || null;

          return {
            title: title,
            content_html: content,
            content_md: '',
            source_url: window.location.href,
            top_image: topImage,
            author: metaAuthor,
            published_at: '',
            source_domain: new URL(window.location.href).hostname,
          };
        },
      });

      this.#articleData = results[0].result;

      const previewTitle = document.getElementById('previewTitle');
      if (previewTitle && this.#articleData) {
        previewTitle.textContent = this.#articleData.title;
      }

      this.updateStatus('idle', '准备就绪');
    } catch (error) {
      console.error('Failed to extract article:', error);
      this.updateStatus('error', '提取文章失败');
    }
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
      const result = await this.#apiClient.createArticle({
        ...this.#articleData,
        category_id: categoryId,
      });

      this.updateStatus('success', `采集成功！文章ID: ${result.id}`);
      this.showSuccessButtons(result.id);
    } catch (error) {
      console.error('Failed to collect article:', error);
      this.updateStatus('error', '采集失败，请重试');
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
