import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { articleApi, categoryApi, Category } from '@/lib/api';
import Link from 'next/link';

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

export default function ConfigPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingConfig, setEditingConfig] = useState<AIConfig | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    dimension: 'summary',
    is_enabled: true,
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o',
    prompt_template: '',
    parameters: '',
    is_default: false,
  });

  const fetchCategories = async () => {
    try {
      const data = await categoryApi.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchConfigs = async (categoryId?: string) => {
    setLoading(true);
    try {
      const data = await articleApi.getAIConfigs(categoryId);
      setConfigs(data);
    } catch (error) {
      console.error('Failed to fetch AI configs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchConfigs(selectedCategory || undefined);
  }, [selectedCategory]);

  const handleEdit = (config: AIConfig) => {
    setEditingConfig(config);
    setShowCreateForm(false);
    setFormData({
      dimension: config.dimension,
      is_enabled: config.is_enabled,
      base_url: config.base_url,
      api_key: config.api_key,
      model_name: config.model_name,
      prompt_template: config.prompt_template || '',
      parameters: config.parameters || '',
      is_default: config.is_default,
    });
  };

  const handleCreate = async () => {
    try {
      await articleApi.createAIConfig({
        ...formData,
        category_id: selectedCategory || undefined,
      });
      alert('配置已创建');
      fetchConfigs(selectedCategory || undefined);
      handleCancel();
    } catch (error) {
      console.error('Failed to create config:', error);
      alert('创建失败');
    }
  };

  const handleSave = async () => {
    if (!editingConfig) return;

    try {
      await articleApi.updateAIConfig(editingConfig.id, formData);
      alert('配置已保存');
      fetchConfigs(selectedCategory || undefined);
      setEditingConfig(null);
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('保存失败');
    }
  };

  const handleCancel = () => {
    setEditingConfig(null);
    setShowCreateForm(false);
    setFormData({
      dimension: 'summary',
      is_enabled: true,
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model_name: 'gpt-4o',
      prompt_template: '',
      parameters: '',
      is_default: false,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/settings" className="text-blue-600 hover:text-blue-700 transition">
              ← 返回设置
            </Link>
            <h1 className="text-xl font-bold text-gray-900">🤖 AI配置管理</h1>
            <div className="w-20"></div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">选择分类</h2>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全局配置</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : showCreateForm ? (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">创建新AI配置</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API地址（Base URL）
                </label>
                <input
                  type="text"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
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
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
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
                  value={formData.model_name}
                  onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="gpt-4o"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词模板
                </label>
                <textarea
                  value={formData.prompt_template}
                  onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
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
                  value={formData.parameters}
                  onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder='{"max_tokens": 500, "temperature": 0.7}'
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_enabled}
                    onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">启用此配置</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">设为默认配置</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  创建
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : configs.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-500">
            暂无配置
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
            >
              + 创建新配置
            </button>
            {configs.map((config) => (
              <div
                key={config.id}
                className="bg-white rounded-lg shadow-sm p-6"
              >
                {editingConfig?.id === config.id ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        API地址（Base URL）
                      </label>
                      <input
                        type="text"
                        value={formData.base_url}
                        onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        API密钥
                      </label>
                      <input
                        type="password"
                        value={formData.api_key}
                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        模型名称
                      </label>
                      <input
                        type="text"
                        value={formData.model_name}
                        onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        提示词模板
                      </label>
                      <textarea
                        value={formData.prompt_template}
                        onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
                        rows={4}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        参数（JSON格式）
                      </label>
                      <textarea
                        value={formData.parameters}
                        onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                        rows={3}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.is_enabled}
                          onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">启用此配置</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.is_default}
                          onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">设为默认配置</span>
                      </label>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                      >
                        保存
                      </button>
                      <button
                        onClick={handleCancel}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {config.dimension}
                          {config.is_default && (
                            <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                              默认
                            </span>
                          )}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-sm ${
                            config.is_enabled
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {config.is_enabled ? '启用' : '禁用'}
                        </span>
                        <button
                          onClick={() => handleEdit(config)}
                          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm"
                        >
                          编辑
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">API地址：</span>
                        <code className="px-2 py-1 bg-gray-50 rounded">{config.base_url}</code>
                      </div>
                      <div>
                        <span className="font-medium">模型：</span>
                        <code className="px-2 py-1 bg-gray-50 rounded">{config.model_name}</code>
                      </div>
                      <div>
                        <span className="font-medium">API密钥：</span>
                        <code className="px-2 py-1 bg-gray-50 rounded">
                          {config.api_key.slice(0, 8)}***
                        </code>
                      </div>
                      {config.category_id && (
                        <div>
                          <span className="font-medium">分类ID：</span>
                          {config.category_id}
                        </div>
                      )}
                      {config.prompt_template && (
                        <div>
                          <span className="font-medium">提示词模板：</span>
                          <pre className="mt-1 p-2 bg-gray-50 rounded overflow-x-auto">
                            {config.prompt_template}
                          </pre>
                        </div>
                      )}
                      {config.parameters && (
                        <div>
                          <span className="font-medium">参数：</span>
                          <pre className="mt-1 p-2 bg-gray-50 rounded overflow-x-auto">
                            {config.parameters}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
