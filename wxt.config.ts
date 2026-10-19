import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [vue()],
  }),
  manifest: ({ browser }) => ({
    name: 'PageSpec',
    description: 'Extract authenticated web PRDs & API specs into clean Markdown bundles and prototype assets for AI agent coding.',
    permissions: [
      'activeTab',
      'storage',
      'downloads',
      'scripting',
      'webNavigation',
      ...(browser === 'firefox' ? [] : ['sidePanel']),
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'PageSpec - PRD & API Extractor',
      default_popup: 'entrypoints/popup/index.html',
      default_icon: {
        16: '/icons/icon-16.png',
        32: '/icons/icon-32.png',
        48: '/icons/icon-48.png',
        128: '/icons/icon-128.png',
      },
    },
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    web_accessible_resources: [
      {
        resources: ['injected.js'],
        matches: ['<all_urls>'],
      },
    ],
  }),
});
