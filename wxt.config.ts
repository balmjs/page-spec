import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [vue()],
  }),
  manifest: ({ browser }) => ({
    name: 'PageSpec',
    description: 'Extract web PRDs, UI design artboards, and API specs into structured local Markdown bundles for AI coding agents.',
    permissions: [
      'activeTab',
      'storage',
      'downloads',
      'webNavigation',
      ...(browser === 'firefox' ? [] : ['scripting', 'sidePanel']),
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'PageSpec',
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
  }),
});
