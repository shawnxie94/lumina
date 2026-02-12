import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';

import Button from '@/components/Button';
import TextArea from '@/components/ui/TextArea';
import { useI18n } from '@/lib/i18n';

interface ArticleSplitEditorModalProps {
  isOpen: boolean;
  title: string;
  closeAriaLabel: string;
  onClose: () => void;
  onSave: () => void;
  topFields: ReactNode;
  contentValue: string;
  onContentChange: (value: string) => void;
  onContentPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  extraEditorActions?: ReactNode;
  contentLabelAddon?: ReactNode;
  contentPlaceholder?: string;
  saveText: string;
  savingText: string;
  isSaving: boolean;
  previewImageUrl: string;
  previewImageAlt: string;
  previewHtml: string;
  closeOnBackdrop?: boolean;
}

const syncScrollPosition = (from: HTMLElement, to: HTMLElement) => {
  const fromScrollable = from.scrollHeight - from.clientHeight;
  if (fromScrollable <= 0) {
    to.scrollTop = 0;
    return;
  }
  const ratio = from.scrollTop / fromScrollable;
  const toScrollable = Math.max(0, to.scrollHeight - to.clientHeight);
  to.scrollTop = ratio * toScrollable;
};

export default function ArticleSplitEditorModal({
  isOpen,
  title,
  closeAriaLabel,
  onClose,
  onSave,
  topFields,
  contentValue,
  onContentChange,
  onContentPaste,
  extraEditorActions,
  contentLabelAddon,
  contentPlaceholder,
  saveText,
  savingText,
  isSaving,
  previewImageUrl,
  previewImageAlt,
  previewHtml,
  closeOnBackdrop = false,
}: ArticleSplitEditorModalProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewImageHidden, setPreviewImageHidden] = useState(false);

  useEffect(() => {
    setPreviewImageHidden(false);
  }, [previewImageUrl]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full h-[95vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h3 className="text-lg font-semibold text-text-1">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            aria-label={closeAriaLabel}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 h-full">
            <div className="p-4 flex flex-col h-full border-r border-border min-h-0">
              <div className="space-y-4">{topFields}</div>

              <div className="mt-4 flex-1 min-h-0 flex flex-col">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm text-text-2">
                    <span>{t('内容（Markdown）')}</span>
                    <span className="text-danger">*</span>
                    {contentLabelAddon}
                  </div>
                  {extraEditorActions && <div className="flex items-center gap-2">{extraEditorActions}</div>}
                </div>
                <TextArea
                  ref={textareaRef}
                  value={contentValue}
                  onChange={(event) => onContentChange(event.target.value)}
                  onPaste={onContentPaste}
                  onScroll={() => {
                    if (!textareaRef.current || !previewRef.current) return;
                    syncScrollPosition(textareaRef.current, previewRef.current);
                  }}
                  className="flex-1 min-h-0 font-mono resize-none"
                  placeholder={contentPlaceholder || t('在此输入 Markdown 内容...')}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  disabled={isSaving}
                >
                  {t('取消')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={onSave}
                  disabled={isSaving}
                >
                  {isSaving ? savingText : saveText}
                </Button>
              </div>
            </div>

            <div
              ref={previewRef}
              onScroll={() => {
                if (!textareaRef.current || !previewRef.current) return;
                syncScrollPosition(previewRef.current, textareaRef.current);
              }}
              className="bg-muted overflow-y-auto h-full hidden lg:block"
            >
              <div className="max-w-3xl mx-auto bg-surface min-h-full shadow-sm">
                <div className="relative w-full aspect-[21/9] overflow-hidden">
                  {!previewImageHidden && (
                    <img
                      src={previewImageUrl}
                      alt={previewImageAlt}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={() => setPreviewImageHidden(true)}
                    />
                  )}
                </div>
                <article className="p-6">
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </article>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
