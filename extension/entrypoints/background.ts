import { logError } from '../utils/errorLogger';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'collect-article',
      title: '📚 采集到知识库',
      contexts: ['page', 'selection'],
    });
  });

  async function ensureContentScriptLoaded(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js'],
        });
        return true;
      } catch (err) {
        console.error('Failed to inject content script:', err);
        logError('background', err instanceof Error ? err : new Error(String(err)), { action: 'injectContentScript', tabId });
        return false;
      }
    }
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'collect-article' || !tab?.id) return;

    try {
      const scriptLoaded = await ensureContentScriptLoaded(tab.id);
      if (!scriptLoaded) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon/128.png',
          title: '采集失败',
          message: '无法在此页面运行，请刷新页面后重试',
        });
        return;
      }

      let extractedData;
      const hasSelection = info.selectionText && info.selectionText.trim().length > 0;

      if (hasSelection) {
        try {
          const selectionData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_SELECTION' });
          if (selectionData && selectionData.content_html) {
            extractedData = selectionData;
          }
        } catch (err) {
          console.log('Selection extraction failed:', err);
        }
      }

      if (!extractedData) {
        extractedData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
      }

      if (!extractedData || !extractedData.content_html) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon/128.png',
          title: '采集失败',
          message: '未能提取到文章内容，请确认页面已加载完成',
        });
        return;
      }

      const articleId = `editor_${Date.now()}`;
      await chrome.storage.local.set({ [articleId]: extractedData });

      const editorUrl = chrome.runtime.getURL(`editor.html?id=${articleId}`);
      chrome.tabs.create({ url: editorUrl });

    } catch (error) {
      console.error('Context menu extraction failed:', error);
      logError('background', error instanceof Error ? error : new Error(String(error)), { action: 'contextMenuExtract', url: tab?.url });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon/128.png',
        title: '采集失败',
        message: '提取内容时出错，请刷新页面后重试',
      });
    }
  });
});
