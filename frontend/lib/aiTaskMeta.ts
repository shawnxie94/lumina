export type AITaskPromptType =
  | "summary"
  | "translation"
  | "key_points"
  | "outline"
  | "quotes"
  | "infographic"
  | "content_cleaning"
  | "content_validation"
  | "classification"
  | "tagging";

type Translate = (key: string) => string;

type AITaskMeta = {
  taskType: string;
  contentType?: string | null;
  labelKey: string;
  filterValue: string;
  promptType?: AITaskPromptType | null;
};

const AI_TASK_META: AITaskMeta[] = [
  {
    taskType: "process_article_cleaning",
    contentType: "content_cleaning",
    labelKey: "清洗",
    filterValue: "process_article_cleaning:content_cleaning",
    promptType: "content_cleaning",
  },
  {
    taskType: "process_article_validation",
    contentType: "content_validation",
    labelKey: "校验",
    filterValue: "process_article_validation:content_validation",
    promptType: "content_validation",
  },
  {
    taskType: "process_article_classification",
    contentType: "classification",
    labelKey: "分类",
    filterValue: "process_article_classification:classification",
    promptType: "classification",
  },
  {
    taskType: "process_article_tagging",
    contentType: "tagging",
    labelKey: "标签",
    filterValue: "process_article_tagging:tagging",
    promptType: "tagging",
  },
  {
    taskType: "process_article_translation",
    contentType: "translation",
    labelKey: "翻译",
    filterValue: "process_article_translation:translation",
    promptType: "translation",
  },
  {
    taskType: "process_article_translation",
    contentType: "translation_title",
    labelKey: "标题翻译",
    filterValue: "process_article_translation:translation_title",
    promptType: "translation",
  },
  {
    taskType: "process_article_embedding",
    contentType: "embedding",
    labelKey: "向量化",
    filterValue: "process_article_embedding:embedding",
    promptType: null,
  },
  {
    taskType: "process_ai_content",
    contentType: "summary",
    labelKey: "摘要",
    filterValue: "process_ai_content:summary",
    promptType: "summary",
  },
  {
    taskType: "process_ai_content",
    contentType: "key_points",
    labelKey: "总结",
    filterValue: "process_ai_content:key_points",
    promptType: "key_points",
  },
  {
    taskType: "process_ai_content",
    contentType: "outline",
    labelKey: "大纲",
    filterValue: "process_ai_content:outline",
    promptType: "outline",
  },
  {
    taskType: "process_ai_content",
    contentType: "quotes",
    labelKey: "金句",
    filterValue: "process_ai_content:quotes",
    promptType: "quotes",
  },
  {
    taskType: "process_ai_content",
    contentType: "infographic",
    labelKey: "信息图",
    filterValue: "process_ai_content:infographic",
    promptType: "infographic",
  },
  {
    taskType: "generate_review_issue",
    labelKey: "回顾",
    filterValue: "generate_review_issue",
    promptType: null,
  },
];

const TASK_TYPE_FALLBACK_LABELS: Record<string, string> = {
  process_article_cleaning: "清洗",
  process_article_validation: "校验",
  process_article_classification: "分类",
  process_article_tagging: "标签",
  process_article_translation: "翻译",
  process_article_embedding: "向量化",
  process_ai_content: "AI内容",
  generate_review_issue: "回顾",
};

function findTaskMeta(
  taskType: string | null | undefined,
  contentType?: string | null,
): AITaskMeta | undefined {
  if (!taskType) return undefined;
  if (contentType) {
    const exact = AI_TASK_META.find(
      (item) => item.taskType === taskType && item.contentType === contentType,
    );
    if (exact) return exact;
  }
  return AI_TASK_META.find((item) => item.taskType === taskType);
}

export function getAITaskLabel(
  taskType: string | null | undefined,
  contentType: string | null | undefined,
  t: Translate,
): string {
  const meta = findTaskMeta(taskType, contentType);
  if (meta) return t(meta.labelKey);
  if (contentType === "embedding") return t("向量化");
  if (contentType === "translation_title") return t("标题翻译");
  if (contentType) return contentType;
  if (taskType && TASK_TYPE_FALLBACK_LABELS[taskType]) {
    return t(TASK_TYPE_FALLBACK_LABELS[taskType]);
  }
  return t("其他");
}

export function getRetryPromptTypeForTask(
  taskType: string | null | undefined,
  contentType: string | null | undefined,
): AITaskPromptType | null {
  return findTaskMeta(taskType, contentType)?.promptType ?? null;
}

function buildFilterOptions(
  t: Translate,
  values: string[],
): Array<{ value: string; label: string }> {
  return values
    .map((value) => {
      const { taskType, contentType } = parseAITaskFilterValue(value);
      return {
        value,
        label: getAITaskLabel(taskType, contentType, t),
      };
    })
    .filter(
      (option, index, items) =>
        items.findIndex((item) => item.value === option.value) === index,
    );
}

export function getAITaskFilterOptions(
  t: Translate,
): Array<{ value: string; label: string }> {
  return buildFilterOptions(
    t,
    AI_TASK_META.map((item) => item.filterValue),
  );
}

export function getAIUsageFilterOptions(
  t: Translate,
): Array<{ value: string; label: string }> {
  return buildFilterOptions(
    t,
    AI_TASK_META.map((item) => item.filterValue),
  );
}

export function parseAITaskFilterValue(value: string | null | undefined): {
  taskType?: string;
  contentType?: string;
} {
  if (!value) return {};
  const [taskType, contentType] = value.split(":");
  return {
    taskType: taskType || undefined,
    contentType: contentType || undefined,
  };
}
