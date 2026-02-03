export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'collect-article',
      title: '采集到知识库',
      contexts: ['page', 'selection'],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'collect-article' || !tab?.id) return;

    try {
      let extractedData;
      const hasSelection = info.selectionText && info.selectionText.trim().length > 0;

      if (hasSelection) {
        extractedData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_SELECTION' });
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
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon/128.png',
        title: '采集失败',
        message: '提取内容时出错，请刷新页面后重试',
      });
    }
  });
});
