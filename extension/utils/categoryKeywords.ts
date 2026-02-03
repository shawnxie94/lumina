export interface CategoryKeywordConfig {
  [categoryName: string]: string[];
}

const STORAGE_KEY = 'categoryKeywords';

export const DEFAULT_CATEGORY_KEYWORDS: CategoryKeywordConfig = {
  '技术': [
    '代码', 'code', '编程', 'programming', 'api', '函数', 'function',
    '开发', 'dev', 'github', '算法', 'algorithm',
    'javascript', 'python', 'java', 'react', 'vue', 'node',
    'css', 'html', '前端', '后端', 'frontend', 'backend',
    '数据库', 'database', 'sql', 'linux', 'docker', 'kubernetes', 'k8s',
    'ai', '人工智能', '机器学习', 'machine learning', 'deep learning',
  ],
  '产品': [
    '产品', 'product', '用户', 'user', '需求', 'requirement',
    '设计', 'design', 'ux', 'ui', '交互', '体验', 'experience',
    '功能', 'feature', 'mvp', '迭代', 'iteration', 'roadmap',
  ],
  '商业': [
    '商业', 'business', '市场', 'market', '营销', 'marketing',
    '增长', 'growth', '融资', 'funding', '投资', 'investment',
    '创业', 'startup', '盈利', 'profit', '收入', 'revenue', '战略', 'strategy',
  ],
  '生活': [
    '生活', 'life', '健康', 'health', '运动', 'exercise',
    '旅行', 'travel', '美食', 'food', '读书', 'reading',
    '电影', 'movie', '音乐', 'music', '摄影', 'photography',
  ],
  '科技': [
    '科技', 'tech', 'technology', '互联网', 'internet',
    '手机', 'phone', 'iphone', 'android', '智能', 'smart',
    '创新', 'innovation', '数字', 'digital', '云', 'cloud',
  ],
  '设计': [
    '设计', 'design', 'ui', 'ux', '界面', 'interface',
    '视觉', 'visual', '色彩', 'color', '排版', 'typography',
    '图标', 'icon', 'figma', 'sketch', 'photoshop',
  ],
  '管理': [
    '管理', 'management', '团队', 'team', '领导', 'leadership',
    '效率', 'efficiency', '协作', 'collaboration', '项目', 'project',
    'okr', 'kpi', '绩效', 'performance',
  ],
};

let cachedKeywords: CategoryKeywordConfig | null = null;

export async function loadCategoryKeywords(): Promise<CategoryKeywordConfig> {
  if (cachedKeywords) return cachedKeywords;
  
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      cachedKeywords = result[STORAGE_KEY] || {};
      resolve(cachedKeywords);
    });
  });
}

export async function saveCategoryKeywords(config: CategoryKeywordConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        cachedKeywords = config;
        resolve();
      }
    });
  });
}

export async function resetCategoryKeywords(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove([STORAGE_KEY], () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        cachedKeywords = null;
        resolve();
      }
    });
  });
}

export async function getCategoryKeywords(categoryName: string): Promise<string[]> {
  const customKeywords = await loadCategoryKeywords();
  
  if (customKeywords[categoryName] && customKeywords[categoryName].length > 0) {
    return customKeywords[categoryName];
  }
  
  const name = categoryName.toLowerCase();
  for (const [key, keywords] of Object.entries(DEFAULT_CATEGORY_KEYWORDS)) {
    if (name.includes(key.toLowerCase()) || key.toLowerCase().includes(name)) {
      return keywords;
    }
  }
  
  return [categoryName.toLowerCase()];
}

export function getDefaultKeywordsForCategory(categoryName: string): string[] {
  const name = categoryName.toLowerCase();
  for (const [key, keywords] of Object.entries(DEFAULT_CATEGORY_KEYWORDS)) {
    if (name.includes(key.toLowerCase()) || key.toLowerCase().includes(name)) {
      return keywords;
    }
  }
  return [];
}

export async function autoMatchCategory(
  text: string,
  categories: Array<{ id: string; name: string }>,
  minScore = 2
): Promise<string | null> {
  const lowerText = text.toLowerCase();
  let bestMatch: { id: string; name: string } | null = null;
  let bestScore = 0;

  for (const category of categories) {
    const keywords = await getCategoryKeywords(category.name);
    let score = 0;

    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }

  return bestScore >= minScore && bestMatch ? bestMatch.id : null;
}
