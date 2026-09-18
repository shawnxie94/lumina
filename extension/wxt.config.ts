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
  // WXT output: extension/.output/chrome-mv3
  outDir: '.output',
  manifest: {
  name: 'Lumina 采集器',
  description: '一键采集网页内容到 Lumina',
    version: '1.0.0',
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus', 'notifications'],
    host_permissions: ['<all_urls>'],
    // WXT 0.17 的 manifest 类型未收录 externally_connectable，但构建时会原样透传。
    ...({ externally_connectable: { matches: connectableMatches } } as Record<string, unknown>),
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
    web_accessible_resources: [
      {
        resources: ['flatten-shadow-dom.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
  runner: {
    disabled: false,
  },
  vite: () => ({
    build: {
      target: 'esnext',
    },
    // Chrome rejects content scripts it cannot treat as UTF-8.
    // Escape non-ASCII (e.g. Temml/math symbols from defuddle/full) as \uXXXX.
    esbuild: {
      charset: 'ascii',
    },
  }),
});
