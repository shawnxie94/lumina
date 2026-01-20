import { useState, useEffect } from 'react';
import Link from 'next/link';
import { articleApi, categoryApi } from '@/lib/api';

type SettingSection = 'ai' | 'categories';

interface AIConfig {
  id: string;
  category_id: string | null;
  dimension: string;
  is_enabled: boolean;
  base_url: string;
  api_key: string;
  model_name: string;
  prompt_template: string | null;
  parameters: string | null;
  is_default: boolean;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  article_count: number;
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingSection>('ai');
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingAIConfig, setEditingAIConfig] = useState<AIConfig | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const [aiFormData, setAIFormData] = useState({
    dimension: 'summary',
    is_enabled: true,
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o',
    prompt_template: '',
    parameters: '',
    is_default: false,
  });

  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6',
    sort_order: 0,
  });

  const fetchAIConfigs = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getAIConfigs(selectedCategory || undefined);
      setAiConfigs(data);
    } catch (error) {
      console.error('Failed to fetch AI configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await categoryApi.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'categories') {
      fetchCategories();
    } else {
      fetchAIConfigs();
    }
  }, [activeSection, selectedCategory]);

  // AI Config handlers
  const handleCreateAInew = () => {
    setEditingAIConfig(null);
    setAIFormData({
      dimension: 'summary',
      is_enabled: true,
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model_name: 'gpt-4o',
      prompt_template: '',
      parameters: '',
      is_default: false,
    });
    setShowAIModal(true);
  };

  const handleEditAI = (config: AIConfig) => {
    setEditingAIConfig(config);
    setAIFormData({
      dimension: config.dimension,
      is_enabled: config.is_enabled,
      base_url: config.base_url,
      api_key: config.api_key,
      model_name: config.model_name,
      prompt_template: config.prompt_template || '',
      parameters: config.parameters || '',
      is_default: config.is_default,
    });
    setShowAIModal(true);
  };

  const handleSaveAI = async () => {
    try {
      if (editingAIConfig) {
        await articleApi.updateAIConfig(editingAIConfig.id, aiFormData);
      } else {
        await articleApi.createAIConfig({
          ...aiFormData,
          category_id: selectedCategory || undefined,
        });
      }
      alert(editingAIConfig ? '配置已更新' : '配置已创建');
      fetchAIConfigs();
      setShowAIModal(false);
      setEditingAIConfig(null);
    } catch (error) {
      console.error('Failed to save AI config:', error);
      alert('保存失败');
    }
  };

  const handleDeleteAI = async (id: string) => {
    if (!confirm('确定要删除这个AI配置吗？')) return;

    try {
      await articleApi.deleteAIConfig(id);
      alert('删除成功');
      fetchAIConfigs();
    } catch (error) {
      console.error('Failed to delete AI config:', error);
      alert('删除失败');
    }
  };

  const handleToggleAIEnabled = async (id: string, isEnabled: boolean) => {
    try {
      await articleApi.updateAIConfig(id, { is_enabled: !isEnabled });
      fetchAIConfigs();
    } catch (error) {
      console.error('Failed to toggle enabled:', error);
      alert('操作失败');
    }
  };

  const handleSetAIDefault = async (id: string) => {
    try {
      await articleApi.updateAIConfig(id, { is_default: true });
      alert('已设置为默认配置');
      fetchAIConfigs();
    } catch (error) {
      console.error('Failed to set default:', error);
      alert('操作失败');
    }
  };

  // Category handlers
  const handleCreateCategoryNew = () => {
    setEditingCategory(null);
    setCategoryFormData({
      name: '',
      description: '',
      color: '#3B82F6',
      sort_order: 0,
    });
    setShowCategoryModal(true);
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryFormData({
      name: category.name,
      description: category.description || '',
      color: category.color,
      sort_order: category.sort_order,
    });
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    try {
      if (editingCategory) {
        await categoryApi.updateCategory(editingCategory.id, categoryFormData);
      } else {
        await categoryApi.createCategory(categoryFormData);
      }
      alert(editingCategory ? '分类已更新' : '分类已创建');
      fetchCategories();
      setShowCategoryModal(false);
      setEditingCategory(null);
    } catch (error) {
      console.error('Failed to save category:', error);
      alert('保存失败');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('确定要删除这个分类吗？')) return;

    try {
      await categoryApi.deleteCategory(id);
      alert('删除成功');
      fetchCategories();
    } catch (error) {
      console.error('Failed to delete category:', error);
      alert('删除失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-blue-600 hover:text-blue-700 transition">
              ← 返回列表
            </Link>
            <h1 className="text-xl font-bold text-gray-900">⚙️ 系统设置</h1>
            <div className="w-20"></div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          <aside className="w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h2 className="font-semibold text-gray-900 mb-4">配置项</h2>
              <div className="space-y-2">
                <button
                  onClick={() => setActiveSection('ai')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition ${
                    activeSection === 'ai' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                >
                  🤖 AI配置
                </button>
                <button
                  onClick={() => setActiveSection('categories')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition ${
                    activeSection === 'categories' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                >
                  🏷️ 分类管理
                </button>
              </div>
            </div>
          </aside>

          <main className="flex-1">
            {activeSection === 'ai' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">AI配置列表</h2>
                  <div className="flex gap-2">
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">全部配置</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleCreateAInew}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      + 创建新配置
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : aiConfigs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    暂无AI配置，点击"创建新配置"按钮开始
                  </div>
                ) : (
                  <div className="space-y-4">
                    {aiConfigs.map((config) => (
                      <div
                        key={config.id}
                        className="border rounded-lg p-4 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">
                                {config.dimension}
                              </h3>
                              {config.is_default && (
                                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                  默认
                                </span>
                              )}
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  config.is_enabled
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {config.is_enabled ? '启用' : '禁用'}
                              </span>
                            </div>

                            <div className="space-y-1 text-sm text-gray-600">
                              <div>
                                <span className="font-medium">API：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.base_url}
                                </code>
                              </div>
                              <div>
                                <span className="font-medium">模型：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.model_name}
                                </code>
                              </div>
                              <div>
                                <span className="font-medium">密钥：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.api_key.slice(0, 8)}***
                                </code>
                              </div>
                              {config.category_id && (
                                <div>
                                  <span className="font-medium">分类：</span>
                                  {categories.find(c => c.id === config.category_id)?.name}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleToggleAIEnabled(config.id, config.is_enabled)}
                              className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 transition"
                              title={config.is_enabled ? '禁用' : '启用'}
                            >
                              {config.is_enabled ? '🔌' : '🔆'}
                            </button>
                            {!config.is_default && (
                              <button
                                onClick={() => handleSetAIDefault(config.id)}
                                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
                                title="设为默认"
                              >
                                ⭐
                              </button>
                            )}
                            <button
                              onClick={() => handleEditAI(config)}
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                              title="编辑"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteAI(config.id)}
                              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                              title="删除"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === 'categories' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">分类列表</h2>
                  <button
                    onClick={handleCreateCategoryNew}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    + 新增分类
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : categories.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    暂无分类，点击"新增分类"按钮开始
                  </div>
                ) : (
                  <div className="space-y-3">
                    {categories.map((category) => (
                      <div
                        key={category.id}
                        className="border rounded-lg p-4 hover:shadow-md transition flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className="w-10 h-10 rounded flex items-center justify-center text-white font-bold text-lg"
                            style={{ backgroundColor: category.color }}
                          >
                            {category.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{category.name}</h3>
                            <p className="text-sm text-gray-600">{category.description || '暂无描述'}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              文章数: {category.article_count}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditCategory(category)}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                            title="编辑"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(category.id)}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                            title="删除"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* AI Config Modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingAIConfig ? '编辑AI配置' : '创建新AI配置'}
              </h3>
              <button
                onClick={() => setShowAIModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API地址（Base URL）
                </label>
                <input
                  type="text"
                  value={aiFormData.base_url}
                  onChange={(e) => setAIFormData({ ...aiFormData, base_url: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://api.openai.com/v1"
                />
                <p className="text-xs text-gray-500 mt-1">例如: https://api.openai.com/v1 或 https://api.siliconflow.cn/v1</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API密钥
                </label>
                <input
                  type="password"
                  value={aiFormData.api_key}
                  onChange={(e) => setAIFormData({ ...aiFormData, api_key: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="sk-..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  模型名称
                </label>
                <input
                  type="text"
                  value={aiFormData.model_name}
                  onChange={(e) => setAIFormData({ ...aiFormData, model_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="gpt-4o"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词模板
                </label>
                <textarea
                  value={aiFormData.prompt_template}
                  onChange={(e) => setAIFormData({ ...aiFormData, prompt_template: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请为以下文章生成摘要..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  参数（JSON格式）
                </label>
                <textarea
                  value={aiFormData.parameters}
                  onChange={(e) => setAIFormData({ ...aiFormData, parameters: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder='{"max_tokens": 500, "temperature": 0.7}'
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aiFormData.is_enabled}
                    onChange={(e) => setAIFormData({ ...aiFormData, is_enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">启用此配置</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aiFormData.is_default}
                    onChange={(e) => setAIFormData({ ...aiFormData, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">设为默认配置</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowAIModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleSaveAI}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {editingAIConfig ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingCategory ? '编辑分类' : '新增分类'}
              </h3>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分类名称
                </label>
                <input
                  type="text"
                  value={categoryFormData.name}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  描述
                </label>
                <textarea
                  value={categoryFormData.description}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  颜色
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={categoryFormData.color}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, color: e.target.value })}
                    className="w-20 h-10 border border-gray-300 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm text-gray-600">{categoryFormData.color}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  排序
                </label>
                <input
                  type="number"
                  value={categoryFormData.sort_order}
                  onChange={(e) => setCategoryFormData({ ...categoryFormData, sort_order: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleSaveCategory}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {editingCategory ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
