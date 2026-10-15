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
    },
    web_accessible_resources: [
      {
        resources: ['injected.js'],
        matches: ['<all_urls>'],
      },
    ],
  }),
});
