import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '文章知识库采集器',
    description: '一键采集网页文章到知识库',
    version: '1.0.0',
    permissions: ['activeTab', 'scripting'],
    action: {
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icon/16.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
    icons: {
      '16': 'icon/16.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png',
    },
  },
});