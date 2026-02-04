import './history.css';
import { getHistory, clearHistory, formatHistoryDate } from '../../utils/history';
import { ApiClient } from '../../utils/api';

class HistoryController {
  #history = [];
  #apiClient;

  constructor() {
    this.#apiClient = new ApiClient();
  }

  async init() {
    await this.loadConfig();
    await this.loadHistory();
    this.setupEventListeners();
  }

  async loadConfig() {
    const apiHost = await ApiClient.loadApiHost();
    this.#apiClient = new ApiClient(apiHost);
  }

  setupEventListeners() {
    document.getElementById('clearAllBtn')?.addEventListener('click', () => this.handleClearAll());
  }

  async loadHistory() {
    this.#history = await getHistory();
    this.render();
  }

  render() {
    this.renderStats();
    this.renderList();
  }

  renderStats() {
    const statsEl = document.getElementById('stats');
    if (!statsEl) return;

    if (this.#history.length === 0) {
      statsEl.innerHTML = '';
      return;
    }

    const domains = new Set(this.#history.map(h => h.domain));
    const categories = new Set(this.#history.filter(h => h.categoryName).map(h => h.categoryName));

    statsEl.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${this.#history.length}</span>
        <span class="stat-label">篇文章</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${domains.size}</span>
        <span class="stat-label">个来源</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${categories.size}</span>
        <span class="stat-label">个分类</span>
      </div>
    `;
  }

  renderList() {
    const listEl = document.getElementById('historyList');
    const emptyEl = document.getElementById('emptyState');
    if (!listEl) return;

    if (this.#history.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.querySelectorAll('.history-item').forEach(el => el.remove());
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.querySelectorAll('.history-item').forEach(el => el.remove());

    for (const item of this.#history) {
      const itemEl = document.createElement('div');
      itemEl.className = 'history-item';
      itemEl.dataset.id = item.id;

      const imageHtml = item.topImage
        ? `<img class="history-item-image" src="${this.escapeHtml(item.topImage)}" alt="" />`
        : `<div class="history-item-image placeholder">📄</div>`;

      const articleUrl = item.articleId 
        ? `${this.#apiClient.frontendUrl}/article/${item.articleId}`
        : item.url;

      itemEl.innerHTML = `
        ${imageHtml}
        <div class="history-item-content">
          <div class="history-item-title">
            <a href="${this.escapeHtml(articleUrl)}" target="_blank">${this.escapeHtml(item.title)}</a>
          </div>
          <div class="history-item-meta">
            <span>🔗 ${this.escapeHtml(item.domain)}</span>
            <span>🕐 ${formatHistoryDate(item.collectedAt)}</span>
          </div>
        </div>
        <div class="history-item-actions">
          ${item.categoryName ? `<span class="history-item-category">${this.escapeHtml(item.categoryName)}</span>` : ''}
          <button class="delete-btn" data-id="${item.id}">删除</button>
        </div>
      `;

      const deleteBtn = itemEl.querySelector('.delete-btn');
      deleteBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDelete(item.id);
      });

      itemEl.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement) {
          if (target.closest('a') || target.closest('button')) return;
        }
        chrome.tabs.create({ url: articleUrl });
      });

      listEl.appendChild(itemEl);
    }
  }

  async handleDelete(id) {
    this.#history = this.#history.filter(h => h.id !== id);
    await chrome.storage.local.set({ collect_history: this.#history });
    this.render();
  }

  async handleClearAll() {
    if (this.#history.length === 0) return;
    
    if (confirm(`确定要清空全部 ${this.#history.length} 条采集记录吗？`)) {
      await clearHistory();
      this.#history = [];
      this.render();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const controller = new HistoryController();
  controller.init();
});
