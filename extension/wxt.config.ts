import { defineConfig } from 'wxt';

const connectableMatches = [
  'http://localhost:3000/*',
  'http://127.0.0.1:3000/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
  'https://*/*',
  'http://*/*',
];

export default defineConfig({
  manifest: {
  name: 'Lumina 采集器',
  description: '一键采集网页内容到 Lumina',
    version: '1.0.0',
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus', 'notifications'],
    host_permissions: ['<all_urls>'],
    externally_connectable: {
      matches: connectableMatches,
    },
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
  runner: {
    disabled: false,
  },
  devtools: {
    enabled: true,
  },
  vite: () => ({
    build: {
      target: 'esnext',
    },
  }),
});
