// 创建文章弹窗的粘贴媒体辅助函数。
// 媒体链接解析类函数（cleanupPastedUrl / detectMediaKindFromUrl / toPastedMediaLink /
// extractMediaLinkFromHtml / extractMediaLinkFromText / buildMarkdownFromMediaLink /
// insertTextAtCursor 及链接模式常量）与本文件原重复定义语义相同，统一从
// frontend/lib/articleMedia.ts 导入；本文件只保留创建流程专用的媒体占位 token 生成。
export const buildCreateMediaToken = (): string =>
  `__LUMINA_CREATE_MEDIA_${Date.now()}_${Math.random().toString(36).slice(2, 10)}__`;
