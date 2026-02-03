import { useState, useEffect } from 'react';
import Link from 'next/link';
import { articleApi, categoryApi, type ModelAPIConfig, type PromptConfig } from '@/lib/api';
import { useToast } from '@/components/Toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type SettingSection = 'ai' | 'categories';
type AISubSection = 'model-api' | 'prompt';
type PromptType = 'summary' | 'key_points' | 'outline' | 'quotes';

const PROMPT_TYPES = [
  { value: 'summary' as PromptType, label: '摘要' },
  { value: 'key_points' as PromptType, label: '关键内容' },
  { value: 'outline' as PromptType, label: '文章大纲' },
  { value: 'quotes' as PromptType, label: '文章金句' },
];

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16',
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#78716C', '#64748B', '#6B7280',
];

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  article_count: number;
}

interface SortableCategoryItemProps {
  category: Category;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
}

function SortableCategoryItem({ category, onEdit, onDelete }: SortableCategoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border rounded-lg p-4 hover:shadow-md transition flex items-center justify-between bg-white"
    >
      <div className="flex items-center gap-4">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 px-1"
          title="拖动排序"
        >
          ⋮⋮
        </button>
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

      <div className="flex gap-1">
        <button
          onClick={() => onEdit(category)}
          className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
          title="编辑"
        >
          ✏️
        </button>
        <button
          onClick={() => onDelete(category.id)}
          className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-red-100 hover:text-red-600 transition"
          title="删除"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { showToast } = useToast();
  const [activeSection, setActiveSection] = useState<SettingSection>('categories');
  const [aiSubSection, setAISubSection] = useState<AISubSection>('model-api');
  const [modelAPIConfigs, setModelAPIConfigs] = useState<ModelAPIConfig[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPromptType, setSelectedPromptType] = useState<PromptType>('summary');

  const [showModelAPIModal, setShowModelAPIModal] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState<PromptConfig | null>(null);

  const [editingModelAPIConfig, setEditingModelAPIConfig] = useState<ModelAPIConfig | null>(null);
  const [editingPromptConfig, setEditingPromptConfig] = useState<PromptConfig | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = categories.findIndex((c) => c.id === active.id);
      const newIndex = categories.findIndex((c) => c.id === over.id);

      const newCategories = arrayMove(categories, oldIndex, newIndex);
      setCategories(newCategories);

      const sortItems = newCategories.map((c, index) => ({
        id: c.id,
        sort_order: index,
      }));

      try {
        await categoryApi.updateCategoriesSort(sortItems);
      } catch (error) {
        console.error('Failed to update sort order:', error);
        fetchCategories();
      }
    }
  };

  const [modelAPIFormData, setModelAPIFormData] = useState({
    name: '',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o',
    is_enabled: true,
    is_default: false,
  });

  const [promptFormData, setPromptFormData] = useState({
    name: '',
    category_id: '',
    type: 'summary',
    prompt: '',
    model_api_config_id: '',
    is_enabled: true,
    is_default: false,
  });

  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6',
    sort_order: 0,
  });

  const fetchModelAPIConfigs = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getModelAPIConfigs();
      setModelAPIConfigs(data);
    } catch (error) {
      console.error('Failed to fetch model API configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPromptConfigs = async () => {
    setLoading(true);
    try {
      const data = await articleApi.getPromptConfigs();
      setPromptConfigs(data);
    } catch (error) {
      console.error('Failed to fetch prompt configs:', error);
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
      if (aiSubSection === 'model-api') {
        fetchModelAPIConfigs();
      } else {
        fetchPromptConfigs();
      }
    }
  }, [activeSection, aiSubSection]);

  const handleCreateModelAPINew = () => {
    setEditingModelAPIConfig(null);
    setModelAPIFormData({
      name: '',
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model_name: 'gpt-4o',
      is_enabled: true,
      is_default: false,
    });
    setShowModelAPIModal(true);
  };

  const handleEditModelAPI = (config: ModelAPIConfig) => {
    setEditingModelAPIConfig(config);
    setModelAPIFormData({
      name: config.name,
      base_url: config.base_url,
      api_key: config.api_key,
      model_name: config.model_name,
      is_enabled: config.is_enabled,
      is_default: config.is_default,
    });
    setShowModelAPIModal(true);
  };

  const handleSaveModelAPI = async () => {
    try {
      if (editingModelAPIConfig) {
        await articleApi.updateModelAPIConfig(editingModelAPIConfig.id, modelAPIFormData);
      } else {
        await articleApi.createModelAPIConfig(modelAPIFormData);
      }
      showToast(editingModelAPIConfig ? '配置已更新' : '配置已创建');
      fetchModelAPIConfigs();
      setShowModelAPIModal(false);
      setEditingModelAPIConfig(null);
    } catch (error) {
      console.error('Failed to save model API config:', error);
      showToast('保存失败', 'error');
    }
  };

  const handleDeleteModelAPI = async (id: string) => {
    if (!confirm('确定要删除这个模型API配置吗？')) return;

    try {
      await articleApi.deleteModelAPIConfig(id);
      showToast('删除成功');
      fetchModelAPIConfigs();
    } catch (error) {
      console.error('Failed to delete model API config:', error);
      showToast('删除失败', 'error');
    }
  };

  const handleTestModelAPI = async (id: string) => {
    try {
      const result = await articleApi.testModelAPIConfig(id);
      if (result.success) {
        showToast('连接测试成功');
      } else {
        showToast(`连接测试失败: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error('Failed to test model API config:', error);
      showToast('测试失败', 'error');
    }
  };

  const handleToggleModelAPIEnabled = async (id: string, isEnabled: boolean) => {
    try {
      await articleApi.updateModelAPIConfig(id, { is_enabled: !isEnabled });
      fetchModelAPIConfigs();
    } catch (error) {
      console.error('Failed to toggle enabled:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleSetModelAPIDefault = async (id: string) => {
    try {
      await articleApi.updateModelAPIConfig(id, { is_default: true });
      showToast('已设置为默认配置');
      fetchModelAPIConfigs();
    } catch (error) {
      console.error('Failed to set default:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleCreatePromptNew = () => {
    setEditingPromptConfig(null);
    setPromptFormData({
      name: '',
      category_id: '',
      type: selectedPromptType,
      prompt: '',
      model_api_config_id: '',
      is_enabled: true,
      is_default: false,
    });
    setShowPromptModal(true);
  };

  const handleEditPrompt = (config: PromptConfig) => {
    setEditingPromptConfig(config);
    setPromptFormData({
      name: config.name,
      category_id: config.category_id || '',
      type: config.type,
      prompt: config.prompt,
      model_api_config_id: config.model_api_config_id || '',
      is_enabled: config.is_enabled,
      is_default: config.is_default,
    });
    setShowPromptModal(true);
  };

  const handleSavePrompt = async () => {
    try {
      const data = {
        ...promptFormData,
        category_id: promptFormData.category_id || undefined,
        model_api_config_id: promptFormData.model_api_config_id || undefined,
      };

      if (editingPromptConfig) {
        await articleApi.updatePromptConfig(editingPromptConfig.id, data);
      } else {
        await articleApi.createPromptConfig(data);
      }
      showToast(editingPromptConfig ? '配置已更新' : '配置已创建');
      fetchPromptConfigs();
      setShowPromptModal(false);
      setEditingPromptConfig(null);
    } catch (error) {
      console.error('Failed to save prompt config:', error);
      showToast('保存失败', 'error');
    }
  };

  const handleDeletePrompt = async (id: string) => {
    if (!confirm('确定要删除这个提示词配置吗？')) return;

    try {
      await articleApi.deletePromptConfig(id);
      showToast('删除成功');
      fetchPromptConfigs();
    } catch (error) {
      console.error('Failed to delete prompt config:', error);
      showToast('删除失败', 'error');
    }
  };

  const handleTogglePromptEnabled = async (id: string, isEnabled: boolean) => {
    try {
      await articleApi.updatePromptConfig(id, { is_enabled: !isEnabled });
      fetchPromptConfigs();
    } catch (error) {
      console.error('Failed to toggle enabled:', error);
      showToast('操作失败', 'error');
    }
  };

  const handleSetPromptDefault = async (id: string) => {
    try {
      await articleApi.updatePromptConfig(id, { is_default: true });
      showToast('已设置为默认配置');
      fetchPromptConfigs();
    } catch (error) {
      console.error('Failed to set default:', error);
      showToast('操作失败', 'error');
    }
  };

  // Category handlers
  const handleCreateCategoryNew = () => {
    setEditingCategory(null);
    const maxSortOrder = categories.length > 0 
      ? Math.max(...categories.map(c => c.sort_order)) + 1 
      : 0;
    setCategoryFormData({
      name: '',
      description: '',
      color: PRESET_COLORS[0],
      sort_order: maxSortOrder,
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
      showToast(editingCategory ? '分类已更新' : '分类已创建');
      fetchCategories();
      setShowCategoryModal(false);
      setEditingCategory(null);
    } catch (error) {
      console.error('Failed to save category:', error);
      showToast('保存失败', 'error');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('确定要删除这个分类吗？')) return;

    try {
      await categoryApi.deleteCategory(id);
      showToast('删除成功');
      fetchCategories();
    } catch (error) {
      console.error('Failed to delete category:', error);
      showToast('删除失败', 'error');
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
                  onClick={() => setActiveSection('categories')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition ${
                    activeSection === 'categories' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                >
                  🏷️ 分类管理
                </button>
                <button
                  onClick={() => setActiveSection('ai')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition ${
                    activeSection === 'ai' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'
                  }`}
                >
                  🤖 AI配置
                </button>
                {activeSection === 'ai' && (
                  <>
                    <button
                      onClick={() => setAISubSection('model-api')}
                      className={`w-full text-left px-6 py-2 text-sm rounded-lg transition ${
                        aiSubSection === 'model-api' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                      }`}
                    >
                      🔌 模型API配置
                    </button>
                    <button
                      onClick={() => setAISubSection('prompt')}
                      className={`w-full text-left px-6 py-2 text-sm rounded-lg transition ${
                        aiSubSection === 'prompt' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                      }`}
                    >
                      📝 提示词配置
                    </button>
                  </>
                )}
              </div>
            </div>
          </aside>

          <main className="flex-1">
            {activeSection === 'ai' && aiSubSection === 'model-api' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900">模型API配置列表</h2>
                  <button
                    onClick={handleCreateModelAPINew}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    + 创建配置
                  </button>
                </div>

                {loading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : modelAPIConfigs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    暂无模型API配置，点击"创建新配置"按钮开始
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[...modelAPIConfigs].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)).map((config) => (
                      <div
                        key={config.id}
                        className="border rounded-lg p-4 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">
                                {config.name}
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
                                <span className="font-medium">名称：</span>
                                <span>{config.name}</span>
                              </div>
                              <div>
                                <span className="font-medium">API地址：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.base_url}
                                </code>
                              </div>
                              <div>
                                <span className="font-medium">模型名称：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.model_name}
                                </code>
                              </div>
                              <div>
                                <span className="font-medium">API密钥：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs">
                                  {config.api_key.slice(0, 8)}***
                                </code>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => handleTestModelAPI(config.id)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-purple-100 hover:text-purple-600 transition"
                              title="测试连接"
                            >
                              🔗
                            </button>
                            <button
                              onClick={() => handleEditModelAPI(config)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                              title="编辑"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteModelAPI(config.id)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-red-100 hover:text-red-600 transition"
                              title="删除"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSection === 'ai' && aiSubSection === 'prompt' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">提示词配置列表</h2>
                  <button
                    onClick={handleCreatePromptNew}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    + 创建配置
                  </button>
                </div>

                <div className="flex gap-2 mb-6">
                  {PROMPT_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setSelectedPromptType(type.value)}
                      className={`px-4 py-2 text-sm rounded-lg transition ${
                        selectedPromptType === type.value
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : promptConfigs.filter(c => c.type === selectedPromptType).length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    暂无{PROMPT_TYPES.find(t => t.value === selectedPromptType)?.label}配置，点击上方按钮创建
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[...promptConfigs]
                      .filter(c => c.type === selectedPromptType)
                      .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))
                      .map((config) => (
                      <div
                        key={config.id}
                        className="border rounded-lg p-4 hover:shadow-md transition"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">
                                {config.name}
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
                                <span className="font-medium">分类：</span>
                                <span>{config.category_name || '通用'}</span>
                              </div>
                              {config.model_api_config_name && (
                                <div>
                                  <span className="font-medium">关联模型API：</span>
                                  <span>{config.model_api_config_name}</span>
                                </div>
                              )}
                              <div>
                                <span className="font-medium">提示词：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs block mt-1 max-h-20 overflow-y-auto">
                                  {config.prompt.slice(0, 100)}{config.prompt.length > 100 ? '...' : ''}
                                </code>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => setShowPromptPreview(config)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-purple-100 hover:text-purple-600 transition"
                              title="预览"
                            >
                              👁️
                            </button>
                            <button
                              onClick={() => handleEditPrompt(config)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                              title="编辑"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeletePrompt(config.id)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-red-100 hover:text-red-600 transition"
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
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={categories.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-3">
                        {categories.map((category) => (
                          <SortableCategoryItem
                            key={category.id}
                            category={category}
                            onEdit={handleEditCategory}
                            onDelete={handleDeleteCategory}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {showModelAPIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingModelAPIConfig ? '编辑模型API配置' : '创建新模型API配置'}
              </h3>
              <button
                onClick={() => setShowModelAPIModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  配置名称
                </label>
                <input
                  type="text"
                  value={modelAPIFormData.name}
                  onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="OpenAI GPT-4o"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API地址（Base URL）
                </label>
                <input
                  type="text"
                  value={modelAPIFormData.base_url}
                  onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, base_url: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API密钥
                </label>
                <input
                  type="password"
                  value={modelAPIFormData.api_key}
                  onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, api_key: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="sk-..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  模型名称
                </label>
                <input
                  type="text"
                  value={modelAPIFormData.model_name}
                  onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, model_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="gpt-4o"
                  required
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={modelAPIFormData.is_enabled}
                    onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, is_enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">启用此配置</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={modelAPIFormData.is_default}
                    onChange={(e) => setModelAPIFormData({ ...modelAPIFormData, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">设为默认配置</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowModelAPIModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleSaveModelAPI}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {editingModelAPIConfig ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPromptModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingPromptConfig ? '编辑提示词配置' : '创建新提示词配置'}
              </h3>
              <button
                onClick={() => setShowPromptModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  配置名称
                </label>
                <input
                  type="text"
                  value={promptFormData.name}
                  onChange={(e) => setPromptFormData({ ...promptFormData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="文章摘要提示词"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分类
                </label>
                <select
                  value={promptFormData.category_id}
                  onChange={(e) => setPromptFormData({ ...promptFormData, category_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">通用</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词
                </label>
                <textarea
                  value={promptFormData.prompt}
                  onChange={(e) => setPromptFormData({ ...promptFormData, prompt: e.target.value })}
                  rows={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请为以下文章生成摘要..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  关联模型API配置（可选）
                </label>
                <select
                  value={promptFormData.model_api_config_id}
                  onChange={(e) => setPromptFormData({ ...promptFormData, model_api_config_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">使用默认</option>
                  {modelAPIConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={promptFormData.is_enabled}
                    onChange={(e) => setPromptFormData({ ...promptFormData, is_enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">启用此配置</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={promptFormData.is_default}
                    onChange={(e) => setPromptFormData({ ...promptFormData, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">设为默认配置</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowPromptModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleSavePrompt}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                {editingPromptConfig ? '保存' : '创建'}
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
                <div className="grid grid-cols-10 gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCategoryFormData({ ...categoryFormData, color })}
                      className={`w-8 h-8 rounded-lg transition ${
                        categoryFormData.color === color 
                          ? 'ring-2 ring-offset-2 ring-blue-500' 
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
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

      {showPromptPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                提示词预览 - {showPromptPreview.name}
              </h3>
              <button
                onClick={() => setShowPromptPreview(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm">
                  {PROMPT_TYPES.find(t => t.value === showPromptPreview.type)?.label || showPromptPreview.type}
                </span>
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                  分类: {showPromptPreview.category_name || '通用'}
                </span>
                {showPromptPreview.model_api_config_name && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
                    模型: {showPromptPreview.model_api_config_name}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  完整提示词内容
                </label>
                <pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">
                  {showPromptPreview.prompt}
                </pre>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t bg-gray-50">
              <button
                onClick={() => {
                  handleEditPrompt(showPromptPreview);
                  setShowPromptPreview(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                编辑此配置
              </button>
              <button
                onClick={() => setShowPromptPreview(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
