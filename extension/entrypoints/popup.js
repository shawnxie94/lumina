const API_URL = 'http://localhost:8000';

let currentTab = null;
let articleData = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await extractArticle();
  
  document.getElementById('closeBtn').addEventListener('click', () => {
    window.close();
  });
  
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });
  
  document.getElementById('collectBtn').addEventListener('click', collectArticle);
});

async function loadCategories() {
  try {
    const response = await fetch(`${API_URL}/api/categories`);
    const categories = await response.json();
    
    const select = document.getElementById('categorySelect');
    select.innerHTML = '<option value="">选择分类...</option>';
    
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('加载分类失败:', error);
    updateStatus('error', '加载分类失败');
  }
}

async function extractArticle() {
  updateStatus('loading', '正在提取文章内容...');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractContent,
    });
    
    articleData = results[0].result;
    
    document.getElementById('previewTitle').textContent = articleData.title;
    updateStatus('idle', '准备就绪');
  } catch (error) {
    console.error('提取文章失败:', error);
    updateStatus('error', '提取文章失败');
  }
}

function extractContent() {
  const { Readability } = typeof require !== 'undefined' ? require('@mozilla/readability') : window;
  
  const doc = document.cloneNode(true);
  const article = new Readability(doc).parse();
  
  if (!article) {
    return null;
  }
  
  const turndownService = new TurndownService();
  const contentMd = turndownService.turndown(article.content);
  
  const topImage = extractTopImage(article.content);
  
  return {
    title: article.title,
    content_html: article.content,
    content_md: contentMd,
    source_url: window.location.href,
    top_image: topImage,
    author: article.byline,
    published_at: article.publishedTime,
    source_domain: new URL(window.location.href).hostname,
  };
}

function extractTopImage(content) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const img = doc.querySelector('img');
  
  if (img && img.src) {
    return img.src;
  }
  
  return null;
}

async function collectArticle() {
  const categoryId = document.getElementById('categorySelect').value;
  
  if (!categoryId) {
    updateStatus('error', '请选择分类');
    return;
  }
  
  updateStatus('loading', '正在上传文章...');
  
  try {
    const response = await fetch(`${API_URL}/api/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...articleData,
        category_id: categoryId,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      updateStatus('success', `采集成功！文章ID: ${result.id}`);
      
      setTimeout(() => {
        window.close();
      }, 2000);
    } else {
      throw new Error('上传失败');
    }
  } catch (error) {
    console.error('采集失败:', error);
    updateStatus('error', '采集失败，请重试');
  }
}

function updateStatus(type, message) {
  const statusEl = document.getElementById('status');
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}