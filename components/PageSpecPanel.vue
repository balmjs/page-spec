<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  FileText,
  Code2,
  Cpu,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderArchive,
  Layers,
  Copy,
  Check,
} from 'lucide-vue-next';

const props = defineProps<{
  isSidepanel?: boolean;
}>();

type ActiveTab = 'prd' | 'api' | 'mcp';

const currentTab = ref<ActiveTab>('prd');
const pageTitle = ref('正在检测页面...');
const pageUrl = ref('');
const isExtracting = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const extractionError = ref('');

// PRD Last Result
const lastPrdResult = ref<{
  title: string;
  totalAssets: number;
  warnings: string[];
  markdownPreview: string;
} | null>(null);

// API Last Result
const lastApiResult = ref<{
  title: string;
  endpointsCount: number;
  format: string;
  markdownPreview: string;
} | null>(null);

// MCP Bridge Status
const mcpBridgeEnabled = ref(true);
const mcpBridgePort = ref(18492);
const mcpBridgeConnected = ref(false);
const copiedSnippet = ref(false);

const activeHost = computed(() => {
  try {
    return new URL(pageUrl.value).hostname;
  } catch {
    return '未知域名';
  }
});

// Load initial page info & bridge status
onMounted(async () => {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      pageTitle.value = tabs[0].title || '当前网页';
      pageUrl.value = tabs[0].url || '';
    }
  } catch (e) {
    console.error('Failed to get active tab:', e);
  }

  // Get Bridge status
  try {
    const res: any = await browser.runtime.sendMessage({ type: 'GET_MCP_BRIDGE_STATUS' });
    if (res) {
      mcpBridgeEnabled.value = res.enabled;
      mcpBridgeConnected.value = res.connected;
      mcpBridgePort.value = res.port;
    }
  } catch {
    // background might not be ready
  }

  // Listen to progress & bridge status changes
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'EXTRACTION_PROGRESS') {
      progressPercent.value = msg.current;
      progressMessage.value = msg.message;
    }
    if (msg.type === 'MCP_BRIDGE_STATUS_CHANGED') {
      mcpBridgeEnabled.value = msg.enabled;
      mcpBridgeConnected.value = msg.connected;
      mcpBridgePort.value = msg.port;
    }
  });
});

// Mode 1: PRD Extraction
async function handleExtractPrd() {
  if (isExtracting.value) return;
  isExtracting.value = true;
  extractionError.value = '';
  progressPercent.value = 5;
  progressMessage.value = '准备提取当前页面 PRD...';

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('无法连接到当前激活的网页标签');

    const res: any = await browser.tabs.sendMessage(tabId, { type: 'EXTRACT_PRD' });
    if (!res || !res.ok) {
      throw new Error(res?.error || '提取失败，请刷新目标页面后重试');
    }

    lastPrdResult.value = {
      title: res.title,
      totalAssets: res.totalAssets,
      warnings: res.warnings || [],
      markdownPreview: res.markdownPreview,
    };
  } catch (err: any) {
    extractionError.value = err?.message || String(err);
  } finally {
    isExtracting.value = false;
  }
}

// Mode 2: API Extraction
async function handleExtractApi() {
  if (isExtracting.value) return;
  isExtracting.value = true;
  extractionError.value = '';
  progressPercent.value = 5;
  progressMessage.value = '准备分析接口文档与 OpenAPI 规范...';

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('无法连接到当前激活的网页标签');

    const res: any = await browser.tabs.sendMessage(tabId, { type: 'EXTRACT_API' });
    if (!res || !res.ok) {
      throw new Error(res?.error || '提取失败，请刷新目标页面后重试');
    }

    lastApiResult.value = {
      title: res.title,
      endpointsCount: res.endpointsCount,
      format: res.format,
      markdownPreview: res.markdownPreview,
    };
  } catch (err: any) {
    extractionError.value = err?.message || String(err);
  } finally {
    isExtracting.value = false;
  }
}

// Toggle Bridge
async function toggleBridge() {
  mcpBridgeEnabled.value = !mcpBridgeEnabled.value;
  await browser.runtime.sendMessage({
    type: 'SET_MCP_BRIDGE_STATUS',
    enabled: mcpBridgeEnabled.value,
    port: mcpBridgePort.value,
  });
}

// Open SidePanel from popup
function openSidePanel() {
  browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
  window.close();
}

// Copy Cursor MCP Config
function copyMcpConfig() {
  const config = {
    mcpServers: {
      pagespec: {
        command: 'node',
        args: ['/path/to/page-spec/bin/mcp-bridge.mjs'],
      },
    },
  };
  navigator.clipboard.writeText(JSON.stringify(config, null, 2));
  copiedSnippet.value = true;
  setTimeout(() => (copiedSnippet.value = false), 2000);
}
</script>

<template>
  <div class="flex flex-col min-h-[490px] w-full max-w-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 select-none">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
      <div class="flex items-center space-x-2">
        <div class="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow">
          P
        </div>
        <div>
          <div class="flex items-center space-x-1.5">
            <h1 class="text-sm font-bold tracking-tight text-slate-900 dark:text-white">PageSpec</h1>
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">v1.0</span>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[210px]" :title="pageTitle">
            {{ activeHost }}: {{ pageTitle }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-1.5">
        <!-- MCP Status Dot -->
        <div
          class="flex items-center space-x-1 px-2 py-1 rounded-full text-[10px] font-medium cursor-pointer transition"
          :class="mcpBridgeConnected ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'"
          @click="currentTab = 'mcp'"
          :title="mcpBridgeConnected ? 'Local MCP Bridge 已就绪' : 'MCP Bridge 未连接'"
        >
          <span class="w-1.5 h-1.5 rounded-full" :class="mcpBridgeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'"></span>
          <span>{{ mcpBridgeConnected ? 'MCP 就绪' : 'MCP 离线' }}</span>
        </div>

        <!-- Open SidePanel Button -->
        <button
          v-if="!props.isSidepanel"
          @click="openSidePanel"
          class="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition"
          title="在侧边栏常驻打开"
        >
          <ExternalLink class="w-4 h-4" />
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 px-3 pt-2">
      <button
        @click="currentTab = 'prd'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition"
        :class="currentTab === 'prd' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <FolderArchive class="w-3.5 h-3.5" />
        <span>PRD 需求包</span>
      </button>

      <button
        @click="currentTab = 'api'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition"
        :class="currentTab === 'api' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <Code2 class="w-3.5 h-3.5" />
        <span>API 规范</span>
      </button>

      <button
        @click="currentTab = 'mcp'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition"
        :class="currentTab === 'mcp' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <Cpu class="w-3.5 h-3.5" />
        <span>WebMCP 桥接</span>
      </button>
    </nav>

    <!-- Main Content Area -->
    <main class="flex-1 p-4 overflow-y-auto">
      <!-- Error Alert -->
      <div v-if="extractionError" class="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-start space-x-2">
        <AlertCircle class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div class="flex-1">{{ extractionError }}</div>
      </div>

      <!-- Extraction Progress Bar -->
      <div v-if="isExtracting" class="mb-4 p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div class="flex items-center justify-between text-xs font-medium mb-1.5">
          <span class="text-indigo-600 dark:text-indigo-400 flex items-center space-x-1.5">
            <RefreshCw class="w-3.5 h-3.5 animate-spin" />
            <span>{{ progressMessage || '正在处理中...' }}</span>
          </span>
          <span class="text-slate-500">{{ progressPercent }}%</span>
        </div>
        <div class="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
          <div
            class="bg-indigo-600 h-2 rounded-full transition-all duration-300"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
      </div>

      <!-- Tab 1: PRD Extractor -->
      <section v-if="currentTab === 'prd'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center space-x-1.5">
            <Layers class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>智能 PRD 资产包提取</span>
          </h2>
          <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            保留当前会话鉴权态与动态渲染内容。自动定位主文档并剥离导航/侧边栏，将原型截图与 Canvas 画布下载并重写为本地相对路径，一键打包为 LLM 就绪的 ZIP 文件。
          </p>

          <button
            @click="handleExtractPrd"
            :disabled="isExtracting"
            class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99]"
          >
            <Download class="w-4 h-4" />
            <span>{{ isExtracting ? '正在提取打包中...' : '下载 PRD 资产包 (.zip)' }}</span>
          </button>
        </div>

        <!-- PRD Result Card -->
        <div v-if="lastPrdResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-2">
            <CheckCircle2 class="w-4 h-4" />
            <span>打包完成！已触发浏览器下载</span>
          </div>
          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">文档标题:</span>
              <span class="font-medium truncate max-w-[200px]">{{ lastPrdResult.title }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">本地化原型图:</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ lastPrdResult.totalAssets }} 张</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">包含文件:</span>
              <span>index.md + assets/</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 2: API Spec Extractor -->
      <section v-if="currentTab === 'api'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2 flex items-center space-x-1.5">
            <Code2 class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>结构化 API 文档提取</span>
          </h2>
          <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
            优先嗅探 Swagger / OpenAPI 底层 JSON 规范直出高保真 Markdown；针对 Knife4j、Apifox、Redoc 或通用接口文档自动展开折叠面板，并将复杂多层参数表格打平。
          </p>

          <button
            @click="handleExtractApi"
            :disabled="isExtracting"
            class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99]"
          >
            <Download class="w-4 h-4" />
            <span>{{ isExtracting ? '正在解析导出中...' : '下载 API 规范文档 (.md)' }}</span>
          </button>
        </div>

        <!-- API Result Card -->
        <div v-if="lastApiResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-2">
            <CheckCircle2 class="w-4 h-4" />
            <span>提取完成！已生成 API Markdown</span>
          </div>
          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">解析引擎:</span>
              <span class="font-medium px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">{{ lastApiResult.format === 'openapi-spec' ? 'OpenAPI 规格引擎' : 'DOM 深度解析' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">检测接口数:</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ lastApiResult.endpointsCount }} 个</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 3: WebMCP Settings & Bridge -->
      <section v-if="currentTab === 'mcp'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-xs font-bold text-slate-900 dark:text-white">Local MCP Stdio 桥接</h2>
              <p class="text-[11px] text-slate-500">连接本地 Cursor / Claude Code 等客户端</p>
            </div>
            <button
              @click="toggleBridge"
              class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="mcpBridgeEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'"
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="mcpBridgeEnabled ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <span class="text-slate-500">WebSocket 端口</span>
            <span class="font-mono text-slate-700 dark:text-slate-300 font-medium">ws://localhost:{{ mcpBridgePort }}</span>
          </div>

          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-500">连接状态</span>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-semibold"
              :class="mcpBridgeConnected ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'"
            >
              {{ mcpBridgeConnected ? 'Connected (已连接)' : 'Listening (等待本地 CLI 连接)' }}
            </span>
          </div>
        </div>

        <!-- Quick Start for Cursor / Claude -->
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2.5">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-bold text-slate-900 dark:text-white">Cursor / Claude Code 快速配置</h3>
            <button
              @click="copyMcpConfig"
              class="flex items-center space-x-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <component :is="copiedSnippet ? Check : Copy" class="w-3 h-3" />
              <span>{{ copiedSnippet ? '已复制' : '复制配置' }}</span>
            </button>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            在本地终端启动配套 Bridge CLI：
          </p>
          <pre class="p-2 rounded bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto select-all">pnpm bridge</pre>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">
            或在 <code class="font-mono">.cursor/mcp.json</code> 中直接注册该命令，即可在对话中由 AI 自动读取当前网页 PRD 与接口！
          </p>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-[11px] text-slate-400 flex items-center justify-between">
      <span>PageSpec &bull; Chrome &amp; Firefox MV3</span>
      <span class="font-mono">WebMCP Ready</span>
    </footer>
  </div>
</template>
