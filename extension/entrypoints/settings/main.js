import './settings.css';
import { ApiClient } from '../../utils/api';
import {
  loadCategoryKeywords,
  saveCategoryKeywords,
  resetCategoryKeywords,
  getDefaultKeywordsForCategory,
} from '../../utils/categoryKeywords';
import {
  getErrorLogs,
  clearErrorLogs,
  exportErrorLogs,
  formatLogTime,
  setupGlobalErrorHandler,
  logError,
} from '../../utils/errorLogger';

setupGlobalErrorHandler('settings');

class SettingsController {
  #apiClient;
  #categories = [];
  #sectionObserver = null;

  constructor() {
    this.#apiClient = new ApiClient();
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.setupSidebarNavigation();
    this.checkApiHealth();
    await this.loadCategories();
    await this.loadErrorLogs();
  }

  setupSidebarNavigation() {
    try {
      const navItems = document.querySelectorAll('.nav-item');
      const sections = document.querySelectorAll('.section[id]');

      navItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const sectionId = item.dataset.section;
          const section = document.getElementById(sectionId);
          if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });

      if (sections.length > 0 && 'IntersectionObserver' in window) {
        this.#sectionObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const sectionId = entry.target.id;
                this.updateActiveNavItem(sectionId);
              }
            });
          },
          { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
        );

        sections.forEach(section => {
          this.#sectionObserver.observe(section);
        });
      }
    } catch (error) {
      console.error('Failed to setup sidebar navigation:', error);
      logError('settings', error, { action: 'setupSidebarNavigation' });
    }
  }

  updateActiveNavItem(sectionId) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      if (item.dataset.section === sectionId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
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

    document.getElementById('refreshLogsBtn')?.addEventListener('click', () => this.loadErrorLogs());
    document.getElementById('exportLogsBtn')?.addEventListener('click', () => this.exportLogs());
    document.getElementById('clearLogsBtn')?.addEventListener('click', () => this.clearLogs());
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
      logError('settings', error, { action: 'saveApiConfig' });
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
    errorEl.querySelector('span').textContent = '暂无分类，请先在 Lumina 中创建分类';
        return;
      }

      await this.renderCategoryKeywords();
      containerEl?.classList.remove('hidden');
      actionsEl?.classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load categories:', error);
      logError('settings', error, { action: 'loadCategories' });
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
      logError('settings', error, { action: 'saveKeywords' });
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
      logError('settings', error, { action: 'resetKeywords' });
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

  async loadErrorLogs() {
    const container = document.getElementById('errorLogsContainer');
    const countEl = document.getElementById('errorLogCount');
    if (!container) return;

    try {
      const logs = await getErrorLogs();
      
      if (countEl) {
        countEl.textContent = `${logs.length} 条记录`;
      }

      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-logs">暂无错误日志</div>';
        return;
      }

      container.innerHTML = logs.map(log => `
        <div class="error-log-item">
          <div class="error-log-header">
            <div class="error-log-meta">
              <span class="error-log-type ${log.type}">${log.type}</span>
              <span class="error-log-source">${this.escapeHtml(log.source)}</span>
            </div>
            <span class="error-log-time">${formatLogTime(log.timestamp)}</span>
          </div>
          <div class="error-log-message">${this.escapeHtml(log.message)}</div>
          ${log.context ? `<div class="error-log-context">${this.escapeHtml(JSON.stringify(log.context))}</div>` : ''}
          ${log.stack ? `<div class="error-log-stack">${this.escapeHtml(log.stack)}</div>` : ''}
        </div>
      `).join('');
    } catch (error) {
      console.error('Failed to load error logs:', error);
      logError('settings', error, { action: 'loadErrorLogs' });
      container.innerHTML = '<div class="empty-logs">加载错误日志失败</div>';
    }
  }

  async exportLogs() {
    try {
      const logsJson = await exportErrorLogs();
      const blob = new Blob([logsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `error-logs-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showToast('日志已导出', 'success');
    } catch (error) {
      console.error('Failed to export logs:', error);
      logError('settings', error, { action: 'exportLogs' });
      this.showToast('导出失败', 'error');
    }
  }

  async clearLogs() {
    const logs = await getErrorLogs();
    if (logs.length === 0) {
      this.showToast('暂无日志可清空', 'error');
      return;
    }

    if (!confirm(`确定要清空全部 ${logs.length} 条错误日志吗？`)) return;

    try {
      await clearErrorLogs();
      this.showToast('日志已清空', 'success');
      await this.loadErrorLogs();
    } catch (error) {
      console.error('Failed to clear logs:', error);
      logError('settings', error, { action: 'clearLogs' });
      this.showToast('清空失败', 'error');
    }
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
