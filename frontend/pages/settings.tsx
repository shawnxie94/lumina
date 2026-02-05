import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRef } from 'react';

import { useRouter } from 'next/router';
import Link from 'next/link';
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

import { articleApi, categoryApi, type ModelAPIConfig, type PromptConfig } from '@/lib/api';
import AppFooter from '@/components/AppFooter';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { IconEdit, IconEye, IconLink, IconList, IconNote, IconPlug, IconRobot, IconTag, IconTrash } from '@/components/icons';
import { useAuth } from '@/contexts/AuthContext';
import { Select } from 'antd';

type SettingSection = 'ai' | 'categories' | 'tasks';
type AISubSection = 'model-api' | 'prompt';
type PromptType = 'summary' | 'translation' | 'key_points' | 'outline' | 'quotes';

const PROMPT_TYPES = [
  { value: 'summary' as PromptType, label: '摘要' },
  { value: 'translation' as PromptType, label: '翻译' },
  { value: 'key_points' as PromptType, label: '总结' },
  { value: 'outline' as PromptType, label: '大纲' },
  { value: 'quotes' as PromptType, label: '金句' },
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

interface AITaskItem {
  id: string;
  article_id: string | null;
  article_title?: string | null;
  task_type: string;
  content_type: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
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
          <IconEdit className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(category.id)}
          className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-red-100 hover:text-red-600 transition"
          title="删除"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingSection>('categories');
  const [aiSubSection, setAISubSection] = useState<AISubSection>('model-api');
  const [modelAPIConfigs, setModelAPIConfigs] = useState<ModelAPIConfig[]>([]);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [taskItems, setTaskItems] = useState<AITaskItem[]>([]);
  const [modelLoading, setModelLoading] = useState(true);
  const [promptLoading, setPromptLoading] = useState(true);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [selectedPromptType, setSelectedPromptType] = useState<PromptType>('summary');
  const [taskPage, setTaskPage] = useState(1);
  const [taskPageSize, setTaskPageSize] = useState(10);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [taskArticleIdFilter, setTaskArticleIdFilter] = useState('');
  const hasTaskFilters = Boolean(taskStatusFilter || taskTypeFilter || taskArticleIdFilter);

  const [showModelAPIModal, setShowModelAPIModal] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState<PromptConfig | null>(null);

  const [editingModelAPIConfig, setEditingModelAPIConfig] = useState<ModelAPIConfig | null>(null);
  const [editingPromptConfig, setEditingPromptConfig] = useState<PromptConfig | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/login');
    }
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSection = localStorage.getItem('settings_active_section');
    const storedAiSubSection = localStorage.getItem('settings_ai_sub_section');
    const storedPromptType = localStorage.getItem('settings_prompt_type');

    if (storedSection === 'ai' || storedSection === 'categories' || storedSection === 'tasks') {
      setActiveSection(storedSection);
    }
    if (storedAiSubSection === 'model-api' || storedAiSubSection === 'prompt') {
      setAISubSection(storedAiSubSection);
    }
    if (PROMPT_TYPES.some((type) => type.value === storedPromptType)) {
      setSelectedPromptType(storedPromptType as PromptType);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const { section, article_id: articleIdParam } = router.query;
    if (section === 'tasks') {
      setActiveSection('tasks');
    }
    if (articleIdParam && typeof articleIdParam === 'string') {
      setActiveSection('tasks');
      setTaskArticleIdFilter(articleIdParam);
      setTaskPage(1);
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('settings_active_section', activeSection);
    localStorage.setItem('settings_ai_sub_section', aiSubSection);
    localStorage.setItem('settings_prompt_type', selectedPromptType);
  }, [activeSection, aiSubSection, selectedPromptType]);

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
        showToast('排序更新失败', 'error');
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
    system_prompt: '',
    response_format: '',
    temperature: '',
    max_tokens: '',
    top_p: '',
    model_api_config_id: '',
    is_enabled: true,
    is_default: false,
  });
  const [showPromptAdvanced, setShowPromptAdvanced] = useState(false);
  const promptImportInputRef = useRef<HTMLInputElement>(null);

  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6',
    sort_order: 0,
  });

  const fetchModelAPIConfigs = async () => {
    setModelLoading(true);
    try {
      const data = await articleApi.getModelAPIConfigs();
      setModelAPIConfigs(data);
    } catch (error) {
      console.error('Failed to fetch model API configs:', error);
    } finally {
      setModelLoading(false);
    }
  };

  const fetchPromptConfigs = async () => {
    setPromptLoading(true);
    try {
      const data = await articleApi.getPromptConfigs();
      setPromptConfigs(data);
    } catch (error) {
      console.error('Failed to fetch prompt configs:', error);
    } finally {
      setPromptLoading(false);
    }
  };

  const fetchCategories = async () => {
    setCategoryLoading(true);
    try {
      const data = await categoryApi.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    } finally {
      setCategoryLoading(false);
    }
  };

  const fetchTasks = async () => {
    setTaskLoading(true);
    try {
      const [taskTypeValue, contentTypeValue] = taskTypeFilter.split(':');
      const response = await articleApi.getAITasks({
        page: taskPage,
        size: taskPageSize,
        status: taskStatusFilter || undefined,
        task_type: taskTypeValue || undefined,
        content_type: contentTypeValue || undefined,
        article_id: taskArticleIdFilter || undefined,
      });
      setTaskItems(response.data || []);
      setTaskTotal(response.pagination?.total || 0);
    } catch (error) {
      console.error('Failed to fetch AI tasks:', error);
      showToast('任务加载失败', 'error');
    } finally {
      setTaskLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'categories') {
      fetchCategories();
      return;
    }
    if (activeSection === 'ai') {
      if (aiSubSection === 'model-api') {
        fetchModelAPIConfigs();
      } else {
        fetchPromptConfigs();
      }
      return;
    }
    if (activeSection === 'tasks') {
      fetchTasks();
    }
  }, [activeSection, aiSubSection]);

  useEffect(() => {
    if (activeSection !== 'tasks') return;
    fetchTasks();
  }, [taskPage, taskPageSize, taskStatusFilter, taskTypeFilter, taskArticleIdFilter, activeSection]);

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

  const handleCreatePromptNew = () => {
    setEditingPromptConfig(null);
    setPromptFormData({
      name: '',
      category_id: '',
      type: selectedPromptType,
      prompt: '',
      system_prompt: '',
      response_format: '',
      temperature: '',
      max_tokens: '',
      top_p: '',
      model_api_config_id: '',
      is_enabled: true,
      is_default: false,
    });
    setShowPromptAdvanced(false);
    setShowPromptModal(true);
  };

  const handleEditPrompt = (config: PromptConfig) => {
    setEditingPromptConfig(config);
    setPromptFormData({
      name: config.name,
      category_id: config.category_id || '',
      type: config.type,
      prompt: config.prompt,
      system_prompt: config.system_prompt || '',
      response_format: config.response_format || '',
      temperature: config.temperature?.toString() || '',
      max_tokens: config.max_tokens?.toString() || '',
      top_p: config.top_p?.toString() || '',
      model_api_config_id: config.model_api_config_id || '',
      is_enabled: config.is_enabled,
      is_default: config.is_default,
    });
    setShowPromptAdvanced(false);
    setShowPromptModal(true);
  };

  const handleSavePrompt = async () => {
    if (!promptFormData.system_prompt.trim()) {
      showToast('请填写系统提示词', 'error');
      return;
    }
    if (!promptFormData.prompt.trim()) {
      showToast('请填写提示词', 'error');
      return;
    }

    try {
      const data = {
        ...promptFormData,
        category_id: promptFormData.category_id || undefined,
        model_api_config_id: promptFormData.model_api_config_id || undefined,
        system_prompt: promptFormData.system_prompt || undefined,
        response_format: promptFormData.response_format || undefined,
        temperature: promptFormData.temperature ? Number(promptFormData.temperature) : undefined,
        max_tokens: promptFormData.max_tokens ? Number(promptFormData.max_tokens) : undefined,
        top_p: promptFormData.top_p ? Number(promptFormData.top_p) : undefined,
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

  const handleRetryTask = async (taskId: string) => {
    try {
      await articleApi.retryAITasks([taskId]);
      showToast('任务已重试');
      fetchTasks();
    } catch (error) {
      console.error('Failed to retry task:', error);
      showToast('重试失败', 'error');
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (!confirm('确定取消该任务吗？')) return;

    try {
      await articleApi.cancelAITasks([taskId]);
      showToast('任务已取消');
      fetchTasks();
    } catch (error) {
      console.error('Failed to cancel task:', error);
      showToast('取消失败', 'error');
    }
  };


  const getTaskTypeLabel = (task: AITaskItem) => {
    if (task.task_type === 'process_article_translation') return '翻译';
    if (task.task_type === 'process_ai_content') {
      if (task.content_type === 'summary') return '摘要';
      if (task.content_type === 'key_points') return '总结';
      if (task.content_type === 'outline') return '大纲';
      if (task.content_type === 'quotes') return '金句';
      return 'AI内容';
    }
    return '摘要';
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

  const handleExportPromptConfigs = (scope: 'current' | 'all') => {
    const source = scope === 'all'
      ? promptConfigs
      : promptConfigs.filter((config) => config.type === selectedPromptType);

    const exportData = source.map(({ category_name, model_api_config_name, created_at, updated_at, id, ...rest }) => rest);

    const blob = new Blob([JSON.stringify({ configs: exportData }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const suffix = scope === 'all' ? 'all' : selectedPromptType;
    link.href = url;
    link.download = `prompt-configs-${suffix}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportPromptConfigs = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const configs = Array.isArray(parsed) ? parsed : parsed?.configs;
      if (!Array.isArray(configs)) {
        showToast('导入失败：格式不正确', 'error');
        return;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const item of configs) {
        if (!item || typeof item !== 'object') {
          skipped += 1;
          continue;
        }
        const type = String(item.type || '').trim();
        const name = String(item.name || '').trim();
        const prompt = String(item.prompt || '').trim();
        const systemPrompt = String(item.system_prompt || '').trim();

        if (!type || !name || !prompt || !systemPrompt) {
          skipped += 1;
          continue;
        }

        const payload = {
          name,
          type,
          prompt,
          system_prompt: systemPrompt,
          category_id: item.category_id || undefined,
          model_api_config_id: item.model_api_config_id || undefined,
          response_format: item.response_format || undefined,
          temperature: item.temperature ?? undefined,
          max_tokens: item.max_tokens ?? undefined,
          top_p: item.top_p ?? undefined,
          is_enabled: item.is_enabled ?? true,
          is_default: item.is_default ?? false,
        };

        const existing = promptConfigs.find(
          (config) =>
            config.type === type &&
            config.name === name &&
            (config.category_id || '') === (item.category_id || '')
        );

        if (existing) {
          await articleApi.updatePromptConfig(existing.id, payload);
          updated += 1;
        } else {
          await articleApi.createPromptConfig(payload);
          created += 1;
        }
      }

      showToast(`导入完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}`);
      fetchPromptConfigs();
    } catch (error) {
      console.error('Failed to import prompt configs:', error);
      showToast('导入失败，请检查文件内容', 'error');
    } finally {
      if (promptImportInputRef.current) {
        promptImportInputRef.current.value = '';
      }
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-app flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-text-3">加载中...</div>
        </div>
        <AppFooter />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-app flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-text-3 mb-4">无权限访问此页面</div>
            <Link href="/login" className="text-primary hover:underline">
              去登录
            </Link>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app flex flex-col">
      <Head>
        <title>管理台 - Lumina</title>
      </Head>
      <AppHeader />

      <div className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex gap-6">
          <aside className="w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h2 className="font-semibold text-text-1 mb-4">管理模块</h2>
              <div className="space-y-2">
                <button
                  onClick={() => setActiveSection('categories')}
                  className={`w-full text-left px-4 py-3 rounded-sm transition ${
                    activeSection === 'categories' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconTag className="h-4 w-4" />
                    <span>分类管理</span>
                  </span>
                </button>
                <button
                  onClick={() => setActiveSection('ai')}
                  className={`w-full text-left px-4 py-3 rounded-sm transition ${
                    activeSection === 'ai' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconRobot className="h-4 w-4" />
                    <span>AI配置</span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setActiveSection('ai');
                    setAISubSection('model-api');
                  }}
                  className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
                    activeSection === 'ai' && aiSubSection === 'model-api'
                      ? 'bg-primary-soft text-primary-ink'
                      : 'text-text-3 hover:text-text-2 hover:bg-muted'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconPlug className="h-4 w-4" />
                    <span>模型API配置</span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setActiveSection('ai');
                    setAISubSection('prompt');
                  }}
                  className={`w-full text-left px-6 py-2 text-sm rounded-sm transition ${
                    activeSection === 'ai' && aiSubSection === 'prompt'
                      ? 'bg-primary-soft text-primary-ink'
                      : 'text-text-3 hover:text-text-2 hover:bg-muted'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconNote className="h-4 w-4" />
                    <span>提示词配置</span>
                  </span>
                </button>
                <button
                  onClick={() => setActiveSection('tasks')}
                  className={`w-full text-left px-4 py-3 rounded-sm transition ${
                    activeSection === 'tasks' ? 'bg-primary-soft text-primary-ink' : 'hover:bg-muted'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconList className="h-4 w-4" />
                    <span>任务监控</span>
                  </span>
                </button>
              </div>
            </div>
          </aside>

          <main className="flex-1">
            {activeSection === 'ai' && aiSubSection === 'model-api' && (
              <div className="bg-surface rounded-sm shadow-sm border border-border p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-text-1">模型API配置列表</h2>
                  <button
                    onClick={handleCreateModelAPINew}
                    className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
                  >
                    + 创建配置
                  </button>
                </div>

                {modelLoading ? (
                  <div className="text-center py-12 text-text-3">加载中...</div>
                ) : modelAPIConfigs.length === 0 ? (
                  <div className="text-center py-12 text-text-3">
                    <div className="mb-4">暂无模型API配置</div>
                    <button
                      onClick={handleCreateModelAPINew}
                      className="px-4 py-2 bg-primary text-white rounded-sm hover:bg-primary-ink transition"
                    >
                      创建配置
                    </button>
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
                                className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                                title="测试连接"
                              >
                              <IconLink className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleEditModelAPI(config)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                              title="编辑"
                            >
                              <IconEdit className="h-4 w-4" />
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleExportPromptConfigs('current')}
                      className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      导出当前
                    </button>
                    <button
                      onClick={() => handleExportPromptConfigs('all')}
                      className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      导出全部
                    </button>
                    <button
                      onClick={() => promptImportInputRef.current?.click()}
                      className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      导入
                    </button>
                    <button
                      onClick={handleCreatePromptNew}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      + 创建配置
                    </button>
                  </div>
                </div>

                <input
                  ref={promptImportInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={handleImportPromptConfigs}
                />

                <div className="flex gap-2 mb-6">
                  {PROMPT_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setSelectedPromptType(type.value)}
                        className={`px-4 py-2 text-sm rounded-lg transition ${
                          selectedPromptType === type.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                {promptLoading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : promptConfigs.filter(c => c.type === selectedPromptType).length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <div className="mb-4">暂无{PROMPT_TYPES.find(t => t.value === selectedPromptType)?.label}配置</div>
                    <button
                      onClick={handleCreatePromptNew}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      创建配置
                    </button>
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
                                <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                                  {config.category_name || '通用'}
                                </span>
                              </div>
                              {config.model_api_config_name && (
                                <div>
                                  <span className="font-medium">关联模型API：</span>
                                  <span>{config.model_api_config_name}</span>
                                </div>
                              )}
                              {config.system_prompt && (
                                <div>
                                  <span className="font-medium">系统提示词：</span>
                                  <code className="px-2 py-1 bg-gray-50 rounded text-xs block mt-1 max-h-20 overflow-y-auto">
                                    {config.system_prompt.slice(0, 100)}{config.system_prompt.length > 100 ? '...' : ''}
                                  </code>
                                </div>
                              )}
                              <div>
                                <span className="font-medium">提示词：</span>
                                <code className="px-2 py-1 bg-gray-50 rounded text-xs block mt-1 max-h-20 overflow-y-auto">
                                  {config.prompt.slice(0, 100)}{config.prompt.length > 100 ? '...' : ''}
                                </code>
                              </div>
                              {(config.system_prompt || config.response_format || config.temperature != null || config.max_tokens != null || config.top_p != null) && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {config.response_format && (
                                    <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
                                      响应格式: {config.response_format}
                                    </span>
                                  )}
                                  {config.temperature != null && (
                                    <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
                                      温度: {config.temperature}
                                    </span>
                                  )}
                                  {config.max_tokens != null && (
                                    <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
                                      最大Tokens: {config.max_tokens}
                                    </span>
                                  )}
                                  {config.top_p != null && (
                                    <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs">
                                      Top P: {config.top_p}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => setShowPromptPreview(config)}
                                className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                              title="预览"
                            >
                              <IconEye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleEditPrompt(config)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-blue-100 hover:text-blue-600 transition"
                              title="编辑"
                            >
                              <IconEdit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeletePrompt(config.id)}
                              className="px-2 py-1 text-sm text-gray-500 rounded hover:bg-red-100 hover:text-red-600 transition"
                              title="删除"
                            >
                              <IconTrash className="h-4 w-4" />
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

                {categoryLoading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : categories.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <div className="mb-4">暂无分类</div>
                    <button
                      onClick={handleCreateCategoryNew}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                      新增分类
                    </button>
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

            {activeSection === 'tasks' && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">AI 任务监控</h2>
                    <p className="text-sm text-gray-500">查看、重试或取消后台任务</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setTaskStatusFilter('');
                        setTaskTypeFilter('');
                        setTaskArticleIdFilter('');
                        setTaskPage(1);
                      }}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                      disabled={!hasTaskFilters}
                    >
                      清空筛选
                    </button>
                    <button
                      onClick={fetchTasks}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
              <label className="block text-sm text-gray-700 mb-1">状态</label>
                    <Select
                      value={taskStatusFilter}
                      onChange={(value) => { setTaskStatusFilter(value); setTaskPage(1); }}
                      className="select-modern-antd w-full"
                      popupClassName="select-modern-dropdown"
                      options={[
                        { value: '', label: '全部' },
                        { value: 'pending', label: '待处理' },
                        { value: 'processing', label: '处理中' },
                        { value: 'completed', label: '已完成' },
                        { value: 'failed', label: '失败' },
                        { value: 'cancelled', label: '已取消' },
                      ]}
                    />
                  </div>
                  <div>
              <label className="block text-sm text-gray-700 mb-1">任务类型</label>
                    <Select
                      value={taskTypeFilter}
                      onChange={(value) => { setTaskTypeFilter(value); setTaskPage(1); }}
                      className="select-modern-antd w-full"
                      popupClassName="select-modern-dropdown"
                      options={[
                        { value: '', label: '全部' },
                        { value: 'process_article_ai', label: '文章摘要' },
                        { value: 'process_article_translation', label: '翻译生成' },
                        { value: 'process_ai_content:summary', label: 'AI摘要' },
                        { value: 'process_ai_content:outline', label: '大纲生成' },
                        { value: 'process_ai_content:quotes', label: '金句生成' },
                        { value: 'process_ai_content:key_points', label: '总结生成' },
                      ]}
                    />
                  </div>
                  <div>
              <label className="block text-sm text-gray-700 mb-1">文章ID</label>
                    <input
                      value={taskArticleIdFilter}
                      onChange={(e) => { setTaskArticleIdFilter(e.target.value); setTaskPage(1); }}
                      placeholder="输入文章ID"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {taskLoading ? (
                  <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : taskItems.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    {hasTaskFilters ? '暂无匹配任务' : '暂无任务'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left px-4 py-3">任务</th>
                          <th className="text-left px-4 py-3">状态</th>
                          <th className="text-left px-4 py-3">尝试</th>
                          <th className="text-left px-4 py-3">文章</th>
                          <th className="text-left px-4 py-3">时间</th>
                          <th className="text-left px-4 py-3">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {taskItems.map((task) => (
                          <tr key={task.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">
                                {getTaskTypeLabel(task)}生成
                              </div>
                              <div className="text-xs text-gray-500">{task.task_type}</div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  task.status === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : task.status === 'failed'
                                    ? 'bg-red-100 text-red-700'
                                    : task.status === 'processing'
                                    ? 'bg-blue-100 text-blue-700'
                                    : task.status === 'cancelled'
                                    ? 'bg-gray-200 text-gray-600'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {task.status === 'completed'
                                  ? '已完成'
                                  : task.status === 'failed'
                                  ? '失败'
                                  : task.status === 'processing'
                                  ? '处理中'
                                  : task.status === 'cancelled'
                                  ? '已取消'
                                  : '待处理'}
                              </span>
                              {task.last_error && (
                                <div className="text-xs text-red-500 mt-1 line-clamp-1" title={task.last_error}>
                                  {task.last_error}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {task.attempts}/{task.max_attempts}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {task.article_id ? (
                                <Link
                                  href={`/article/${task.article_id}`}
                                  className="text-blue-600 hover:underline"
                                  title={task.article_title || task.article_id}
                                >
                                  {(() => {
                                    const title = task.article_title || '未知文章';
                                    const chars = Array.from(title);
                                    const truncated = chars.slice(0, 10).join('');
                                    return chars.length > 10 ? `${truncated}...` : truncated;
                                  })()}
                                </Link>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              <div>创建：{new Date(task.created_at).toLocaleString('zh-CN')}</div>
                              {task.finished_at && (
                                <div>完成：{new Date(task.finished_at).toLocaleString('zh-CN')}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleRetryTask(task.id)}
                                  className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                                  disabled={task.status === 'processing'}
                                >
                                  重试
                                </button>
                                <button
                                  onClick={() => handleCancelTask(task.id)}
                                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                                  disabled={task.status === 'completed' || task.status === 'cancelled'}
                                >
                                  取消
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>每页显示</span>
                    <Select
                      value={taskPageSize}
                      onChange={(value) => { setTaskPageSize(Number(value)); setTaskPage(1); }}
                      className="select-modern-antd"
                      popupClassName="select-modern-dropdown"
                      options={[
                        { value: 10, label: '10' },
                        { value: 20, label: '20' },
                        { value: 50, label: '50' },
                      ]}
                    />
                    <span>条，共 {taskTotal} 条</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
                      disabled={taskPage === 1}
                      className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <span className="px-4 py-2 bg-white border rounded-lg">
                      第 {taskPage} / {Math.ceil(taskTotal / taskPageSize) || 1} 页
                    </span>
                    <button
                      onClick={() => setTaskPage((p) => p + 1)}
                      disabled={taskPage * taskPageSize >= taskTotal}
                      className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {showModelAPIModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowModelAPIModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
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
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowPromptModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
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
                <Select
                  value={promptFormData.category_id}
                  onChange={(value) => setPromptFormData({ ...promptFormData, category_id: value })}
                  className="select-modern-antd w-full"
                  popupClassName="select-modern-dropdown"
                  options={[
                    { value: '', label: '通用' },
                    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
                  ]}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  系统提示词
                </label>
                <textarea
                  value={promptFormData.system_prompt}
                  onChange={(e) => setPromptFormData({ ...promptFormData, system_prompt: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="系统级约束，例如：你是一个严谨的内容分析助手..."
                  required
                />
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

              <div className="border border-gray-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setShowPromptAdvanced(!showPromptAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span>高级设置（可选）</span>
                  <span className="text-gray-400">{showPromptAdvanced ? '收起' : '展开'}</span>
                </button>
                {showPromptAdvanced && (
                  <div className="border-t border-gray-200 p-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          响应格式
                        </label>
                        <Select
                          value={promptFormData.response_format}
                          onChange={(value) => setPromptFormData({ ...promptFormData, response_format: value })}
                          className="select-modern-antd w-full"
                          popupClassName="select-modern-dropdown"
                          options={[
                            { value: '', label: '默认' },
                            { value: 'text', label: 'text' },
                            { value: 'json_object', label: 'json_object' },
                          ]}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          温度
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={promptFormData.temperature}
                          onChange={(e) => setPromptFormData({ ...promptFormData, temperature: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0.7"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          最大 Tokens
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={promptFormData.max_tokens}
                          onChange={(e) => setPromptFormData({ ...promptFormData, max_tokens: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="1200"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Top P
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="1"
                          value={promptFormData.top_p}
                          onChange={(e) => setPromptFormData({ ...promptFormData, top_p: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="1.0"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  关联模型API配置（可选）
                </label>
                <Select
                  value={promptFormData.model_api_config_id}
                  onChange={(value) => setPromptFormData({ ...promptFormData, model_api_config_id: value })}
                  className="select-modern-antd w-full"
                  popupClassName="select-modern-dropdown"
                  options={[
                    { value: '', label: '使用默认' },
                    ...modelAPIConfigs.map((config) => ({ value: config.id, label: config.name })),
                  ]}
                />
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
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowCategoryModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
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
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowPromptPreview(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
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
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
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
                  系统提示词
                </label>
                <pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">
                  {showPromptPreview.system_prompt || '未设置（必填）'}
                </pre>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提示词
                </label>
                <pre className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 whitespace-pre-wrap font-mono">
                  {showPromptPreview.prompt}
                </pre>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  <div className="text-xs text-gray-500">响应格式</div>
                  <div>{showPromptPreview.response_format || '默认'}</div>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  <div className="text-xs text-gray-500">温度</div>
                  <div>{showPromptPreview.temperature ?? '默认'}</div>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  <div className="text-xs text-gray-500">最大 Tokens</div>
                  <div>{showPromptPreview.max_tokens ?? '默认'}</div>
                </div>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                  <div className="text-xs text-gray-500">Top P</div>
                  <div>{showPromptPreview.top_p ?? '默认'}</div>
                </div>
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
      <AppFooter />
    </div>
  );
}
