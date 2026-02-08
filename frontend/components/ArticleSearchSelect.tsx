import { useState, useEffect, useRef, useCallback } from 'react';
import { articleApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ArticleOption {
  id: string;
  title: string;
  slug: string;
}

interface ArticleSearchSelectProps {
  label: string;
  value: string;
  onChange: (value: string, article?: ArticleOption) => void;
  placeholder?: string;
  className?: string;
}

export function ArticleSearchSelect({
  label,
  value,
  onChange,
  placeholder,
  className = '',
}: ArticleSearchSelectProps) {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<ArticleOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<ArticleOption | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // 点击外部关闭下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 当 value 变化时，重置输入框
  useEffect(() => {
    if (!value) {
      setInputValue('');
      setSelectedArticle(null);
    }
  }, [value]);

  // 搜索文章
  const searchArticles = useCallback(async (query: string) => {
    if (!query.trim()) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const results = await articleApi.searchArticles(query);
      setOptions(results);
    } catch (error) {
      console.error('搜索文章失败:', error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 输入变化时的防抖搜索
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      searchArticles(newValue);
    }, 300);
  };

  // 选择文章
  const handleSelect = (article: ArticleOption) => {
    setInputValue(article.title);
    setSelectedArticle(article);
    setIsOpen(false);
    onChange(article.title, article);
  };

  // 清除选择
  const handleClear = () => {
    setInputValue('');
    setSelectedArticle(null);
    setOptions([]);
    onChange('', undefined);
  };

  const inputId = `article-search-${label}`;
  const resolvedPlaceholder = placeholder || t('搜索文章标题...');

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <label htmlFor={inputId} className="block text-sm text-text-2 mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            setIsOpen(true);
            if (inputValue) searchArticles(inputValue);
          }}
          placeholder={resolvedPlaceholder}
          className="w-full h-9 px-3 pr-8 border border-border rounded-sm bg-surface text-text-1 text-sm placeholder:text-sm placeholder:text-text-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
        {(inputValue || selectedArticle) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <title>{t('清除')}</title>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="px-3 py-2 text-sm text-text-3">{t('搜索中...')}</div>
          ) : options.length > 0 ? (
            options.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => handleSelect(article)}
                className="w-full px-3 py-2 text-left text-sm text-text-1 hover:bg-muted transition-colors"
              >
                <div className="truncate">{article.title}</div>
              </button>
            ))
          ) : inputValue ? (
            <div className="px-3 py-2 text-sm text-text-3">{t('未找到匹配的文章')}</div>
          ) : (
            <div className="px-3 py-2 text-sm text-text-3">{t('输入关键词搜索文章')}</div>
          )}
        </div>
      )}
    </div>
  );
}
