import { ApiClient } from '../../utils/api';
import { marked } from 'marked';

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
      this.setupPreviewToggles();
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
    const htmlPreview = document.getElementById('htmlPreview');
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

    if (contentHtml) {
      const rawHtml = this.#articleData.content_html || '';
      contentHtml.value = this.formatHtmlString(rawHtml);
    }

    if (contentMd) {
      contentMd.value = this.#articleData.content_md || '';
    }

    if (htmlPreview) {
      htmlPreview.innerHTML = this.#articleData.content_html || '<p>无内容</p>';
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
      this.setupTopImageSelector(this.#articleData.content_html, this.#articleData.top_image);
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

  setupTopImageSelector(htmlContent, defaultImage) {
    const topImageGroup = document.getElementById('topImageGroup');
    const topImageSelect = document.getElementById('topImageSelect');
    const topImagePreview = document.getElementById('topImagePreview');

    if (!topImageGroup || !topImageSelect || !topImagePreview) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));

    const uniqueImages = new Set();
    images.forEach(img => {
      if (img.src) {
        uniqueImages.add(img.src);
      }
    });

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

  showPublishedAt() {
    const publishedAtGroup = document.getElementById('publishedAtGroup');

    if (publishedAtGroup) {
      publishedAtGroup.style.display = 'block';
    }
  }

  formatHtmlString(html) {
    if (!html) return '';

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const formatNode = (node, indent = 0) => {
        const prefix = '  '.repeat(indent);
        let result = '';

        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text) {
            result += prefix + text + '\n';
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          result += prefix + '<' + tag;

          if (node.attributes.length > 0) {
            for (const attr of node.attributes) {
              result += ` ${attr.name}="${attr.value}"`;
            }
          }

          result += '>\n';

          for (const child of node.childNodes) {
            result += formatNode(child, indent + 1);
          }

          result += prefix + '</' + tag + '>\n';
        }

        return result;
      };

      const formattedHtml = formatNode(doc.body, 0);
      return formattedHtml.trim();
    } catch (error) {
      console.error('Failed to format HTML:', error);

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const formatNodeSimple = (node, indent = 0) => {
        const prefix = '  '.repeat(indent);
        let result = '';

        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text) {
            result += text;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          const isInline = ['span', 'a', 'strong', 'em', 'code', 'b', 'i', 'img', 'br'].includes(tag);

          if (!isInline) {
            result += '\n' + prefix;
          }

          result += '<' + tag;

          if (node.attributes.length > 0) {
            for (const attr of node.attributes) {
              result += ` ${attr.name}="${attr.value}"`;
            }
          }

          result += '>';

          for (const child of node.childNodes) {
            result += formatNodeSimple(child, indent + (isInline ? 0 : 1));
          }

          result += '</' + tag + '>';

          if (!isInline) {
            result += '\n';
          }
        }

        return result;
      };

      let formattedHtml = '';
      for (const child of doc.body.childNodes) {
        formattedHtml += formatNodeSimple(child, 0);
      }

      return formattedHtml.trim();
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
    const toggleMdBtn = document.getElementById('toggleMdBtn');
    const contentHtml = document.getElementById('contentHtml');
    const contentMd = document.getElementById('contentMd');
    const htmlPreview = document.getElementById('htmlPreview');
    const mdPreview = document.getElementById('mdPreview');

    if (toggleHtmlBtn && contentHtml && htmlPreview) {
      toggleHtmlBtn.addEventListener('click', () => {
        const isEditingMode = !contentHtml.classList.contains('hidden');
        if (isEditingMode) {
          htmlPreview.innerHTML = contentHtml.value || '<p>无内容</p>';
          contentHtml.classList.add('hidden');
          htmlPreview.classList.remove('hidden');
          toggleHtmlBtn.textContent = '编辑';
        } else {
          contentHtml.classList.remove('hidden');
          htmlPreview.classList.add('hidden');
          toggleHtmlBtn.textContent = '预览';
        }
      });
    }

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
    const contentHtml = document.getElementById('contentHtml');
    const contentMd = document.getElementById('contentMd');
    const publishedAtInput = document.getElementById('publishedAtInput');
    const topImageSelect = document.getElementById('topImageSelect');

    const title = titleInput?.value?.trim();
    const author = authorInput?.value?.trim();
    const htmlContent = contentHtml?.value;
    const mdContent = contentMd?.value;
    const publishedAt = publishedAtInput?.value || '';
    const topImage = topImageSelect?.value || null;

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
        top_image: topImage,
        published_at: publishedAt,
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
