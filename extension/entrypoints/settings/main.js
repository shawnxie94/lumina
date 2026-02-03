import './settings.css';
import { ApiClient } from '../../utils/api';
import {
  loadCategoryKeywords,
  saveCategoryKeywords,
  resetCategoryKeywords,
  getDefaultKeywordsForCategory,
} from '../../utils/categoryKeywords';

class SettingsController {
  #apiClient;
  #categories = [];

  constructor() {
    this.#apiClient = new ApiClient();
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.checkApiHealth();
    await this.loadCategories();
  }

  async loadConfig() {
    const apiHost = await ApiClient.loadApiHost();
    this.#apiClient = new ApiClient(apiHost);

    const apiHostInput = document.getElementById('apiHostInput');
    if (apiHostInput) {
      apiHostInput.value = apiHost;
    }
  }

  setupEventListeners() {
    document.getElementById('saveApiBtn')?.addEventListener('click', () => this.saveApiConfig());
    document.getElementById('retryLoadBtn')?.addEventListener('click', () => this.loadCategories());
    document.getElementById('saveKeywordsBtn')?.addEventListener('click', () => this.saveKeywords());
    document.getElementById('resetKeywordsBtn')?.addEventListener('click', () => this.resetKeywords());
    
    document.getElementById('apiHostInput')?.addEventListener('change', () => this.checkApiHealth());
  }

  async checkApiHealth() {
    const indicator = document.getElementById('connectionIndicator');
    const dot = indicator?.querySelector('.status-dot');
    const text = indicator?.querySelector('.status-text');
    if (!indicator || !dot || !text) return;

    dot.className = 'status-dot checking';
    text.textContent = '检测中...';

    const { ok, latency } = await this.#apiClient.checkHealth();

    dot.classList.remove('checking');
    if (ok) {
      dot.classList.add('connected');
      text.textContent = `已连接 (${latency}ms)`;
    } else {
      dot.classList.add('disconnected');
      text.textContent = '无法连接';
    }
  }

  async saveApiConfig() {
    const apiHostInput = document.getElementById('apiHostInput');
    const newApiHost = apiHostInput?.value.trim();

    if (!newApiHost) {
      this.showToast('请输入有效的 API 地址', 'error');
      return;
    }

    try {
      await ApiClient.saveApiHost(newApiHost);
      this.#apiClient = new ApiClient(newApiHost);
      this.showToast('API 配置已保存', 'success');
      this.checkApiHealth();
      await this.loadCategories();
    } catch (error) {
      console.error('Failed to save API config:', error);
      this.showToast('保存失败', 'error');
    }
  }

  async loadCategories() {
    const loadingEl = document.getElementById('categoriesLoading');
    const errorEl = document.getElementById('categoriesError');
    const containerEl = document.getElementById('categoryKeywordsContainer');
    const actionsEl = document.getElementById('keywordsActions');

    loadingEl?.classList.remove('hidden');
    errorEl?.classList.add('hidden');
    containerEl?.classList.add('hidden');
    actionsEl?.classList.add('hidden');

    try {
      this.#categories = await this.#apiClient.getCategories();
      loadingEl?.classList.add('hidden');

      if (this.#categories.length === 0) {
        errorEl?.classList.remove('hidden');
        errorEl.querySelector('span').textContent = '暂无分类，请先在知识库中创建分类';
        return;
      }

      await this.renderCategoryKeywords();
      containerEl?.classList.remove('hidden');
      actionsEl?.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load categories:', error);
      loadingEl?.classList.add('hidden');
      errorEl?.classList.remove('hidden');
    }
  }

  async renderCategoryKeywords() {
    const container = document.getElementById('categoryKeywordsContainer');
    if (!container) return;

    const customKeywords = await loadCategoryKeywords();
    container.innerHTML = '';

    for (const category of this.#categories) {
      const keywords = customKeywords[category.name] || getDefaultKeywordsForCategory(category.name);
      const keywordsText = keywords.join(', ');
      const isCustom = customKeywords[category.name] && customKeywords[category.name].length > 0;

      const itemEl = document.createElement('div');
      itemEl.className = 'category-item';
      itemEl.dataset.categoryName = category.name;

      itemEl.innerHTML = `
        <div class="category-item-header">
          <span class="category-name">${this.escapeHtml(category.name)}</span>
          <span class="keyword-count">${keywords.length} 个关键词${isCustom ? ' (自定义)' : ''}</span>
        </div>
        <textarea 
          class="keywords-input" 
          data-category="${this.escapeHtml(category.name)}"
          placeholder="输入关键词，用逗号分隔"
        >${this.escapeHtml(keywordsText)}</textarea>
        <div class="keywords-hint">用逗号分隔多个关键词，支持中英文</div>
      `;

      const textarea = itemEl.querySelector('textarea');
      textarea?.addEventListener('input', () => this.updateKeywordCount(itemEl, textarea));

      container.appendChild(itemEl);
    }
  }

  updateKeywordCount(itemEl, textarea) {
    const countEl = itemEl.querySelector('.keyword-count');
    if (!countEl) return;

    const keywords = this.parseKeywords(textarea.value);
    countEl.textContent = `${keywords.length} 个关键词 (已修改)`;
  }

  parseKeywords(text) {
    return text
      .split(/[,，]/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
  }

  async saveKeywords() {
    const textareas = document.querySelectorAll('.keywords-input');
    const config = {};

    textareas.forEach(textarea => {
      const categoryName = textarea.dataset.category;
      const keywords = this.parseKeywords(textarea.value);
      if (keywords.length > 0) {
        config[categoryName] = keywords;
      }
    });

    try {
      await saveCategoryKeywords(config);
      this.showToast('关键词配置已保存', 'success');
      await this.renderCategoryKeywords();
    } catch (error) {
      console.error('Failed to save keywords:', error);
      this.showToast('保存失败', 'error');
    }
  }

  async resetKeywords() {
    if (!confirm('确定要恢复所有分类的默认关键词吗？')) return;

    try {
      await resetCategoryKeywords();
      this.showToast('已恢复默认关键词', 'success');
      await this.renderCategoryKeywords();
    } catch (error) {
      console.error('Failed to reset keywords:', error);
      this.showToast('重置失败', 'error');
    }
  }

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast ${type}`;

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const controller = new SettingsController();
  controller.init();
});
