import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
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

export default function SettingsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SettingSection>('ai');
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAIConfigs = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getAIConfigs();
      setAiConfigs(data);
    } catch (error) {
      console.error('Failed to fetch AI configs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAIConfigs();
  }, []);

  const handleDeleteAIConfig = async (id: string) => {
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

  const handleSetDefault = async (id: string) => {
    try {
      await articleApi.updateAIConfig(id, { is_default: true });
      alert('已设置为默认配置');
      fetchAIConfigs();
    } catch (error) {
      console.error('Failed to set default:', error);
      alert('操作失败');
    }
  };

  const handleToggleEnabled = async (id: string, isEnabled: boolean) => {
    try {
      await articleApi.updateAIConfig(id, { is_enabled: !isEnabled });
      fetchAIConfigs();
    } catch (error) {
      console.error('Failed to toggle enabled:', error);
      alert('操作失败');
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
                  <Link
                    href="/config"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    + 创建新配置
                  </Link>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : aiConfigs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    暂无AI配置，点击右上角按钮创建
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
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
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
                                  <span className="font-medium">分类ID：</span>
                                  <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                    {config.category_id}
                                  </code>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleToggleEnabled(config.id, config.is_enabled)}
                              className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 transition"
                              title={config.is_enabled ? '禁用' : '启用'}
                            >
                              {config.is_enabled ? '🔌' : '🔆'}
                            </button>
                            {!config.is_default && (
                              <button
                                onClick={() => handleSetDefault(config.id)}
                                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
                                title="设为默认"
                              >
                                ⭐
                              </button>
                            )}
                            <button
                              onClick={() => router.push(`/config?edit=${config.id}`)}
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                              title="编辑"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteAIConfig(config.id)}
                              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition"
                              title="删除"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        {config.prompt_template && (
                          <div className="border-t pt-3">
                            <span className="text-sm font-medium text-gray-700">提示词模板：</span>
                            <pre className="mt-1 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                              {config.prompt_template}
                            </pre>
                          </div>
                        )}

                        {config.parameters && (
                          <div className="border-t pt-3">
                            <span className="text-sm font-medium text-gray-700">参数：</span>
                            <pre className="mt-1 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                              {config.parameters}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === 'categories' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">分类管理</h2>
                <div className="text-gray-600">
                  <p className="mb-4">管理文章分类、颜色和排序。</p>
                  <div className="space-y-2">
                    <Link
                      href="/categories"
                      className="block px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-center"
                    >
                      进入分类管理页面 →
                    </Link>
                    <p className="text-sm text-gray-500">
                      创建、编辑、删除分类
                    </p>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
