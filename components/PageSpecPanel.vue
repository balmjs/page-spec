<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  FolderArchive,
  Code2,
  FolderSync,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  FolderCheck,
  HardDrive,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-vue-next';
import {
  isFileSystemAccessSupported,
  pickRequirementsDirectory,
  getSavedRequirementsDirectory,
  removeSavedRequirementsDirectory,
  writePrdBundleToDirectory,
  writeApiSpecToDirectory,
  verifyDirectoryPermission,
} from '../utils/filesystem-writer';
import type { BestFrameResult } from '../entrypoints/background';

const props = defineProps<{
  isSidepanel?: boolean;
}>();

type ActiveTab = 'prd' | 'api' | 'dir';

const currentTab = ref<ActiveTab>('prd');
const pageTitle = ref('正在检测页面与框架...');
const pageUrl = ref('');
const isExtracting = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const extractionError = ref('');

// Frame Detection Info
const bestFrame = ref<BestFrameResult | null>(null);
const isDetectingFrames = ref(false);

// Local Requirements Directory Handle
const savedDirHandle = ref<FileSystemDirectoryHandle | null>(null);
const dirName = ref<string>('');
const isFsSupported = ref(isFileSystemAccessSupported());

// PRD Extraction Result
const lastPrdResult = ref<{
  title: string;
  totalAssets: number;
  warnings: string[];
  markdownPreview: string;
  savedToDirectory?: boolean;
  directoryName?: string;
} | null>(null);

// API Extraction Result
const lastApiResult = ref<{
  title: string;
  endpointsCount: number;
  format: string;
  markdownPreview: string;
  savedToDirectory?: boolean;
  directoryName?: string;
} | null>(null);

const activeHost = computed(() => {
  try {
    return new URL(pageUrl.value).hostname;
  } catch {
    return '未知域名';
  }
});

// Initialize active tab and inspect frame hierarchy
onMounted(async () => {
  // 1. Get saved directory handle
  try {
    const handle = await getSavedRequirementsDirectory();
    if (handle) {
      savedDirHandle.value = handle;
      dirName.value = handle.name;
    }
  } catch (err) {
    console.warn('[PageSpec] Failed to load saved directory handle:', err);
  }

  // 2. Query active tab
  let activeTabId: number | undefined;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      activeTabId = tabs[0].id;
      pageTitle.value = tabs[0].title || '当前网页';
      pageUrl.value = tabs[0].url || '';
    }
  } catch (e) {
    console.error('Failed to get active tab:', e);
  }

  // 3. Detect best content frame (piercing iframes)
  if (activeTabId) {
    detectFrames(activeTabId);
  }

  // 4. Listen to progress messages
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'EXTRACTION_PROGRESS') {
      progressPercent.value = msg.current;
      progressMessage.value = msg.message;
    }
  });
});

async function detectFrames(tabId: number) {
  isDetectingFrames.value = true;
  try {
    const res: any = await browser.runtime.sendMessage({
      type: 'DETECT_BEST_PRD_FRAME',
      tabId,
    });
    if (res && res.ok && res.data) {
      bestFrame.value = res.data;
      if (res.data.bestTitle) {
        pageTitle.value = res.data.bestTitle;
      }
    }
  } catch (err) {
    console.warn('[PageSpec] Frame detection error:', err);
  } finally {
    isDetectingFrames.value = false;
  }
}

// Directory Selection
async function handleSelectDirectory() {
  try {
    extractionError.value = '';
    const handle = await pickRequirementsDirectory();
    savedDirHandle.value = handle;
    dirName.value = handle.name;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || '选择目录失败';
    }
  }
}

async function handleClearDirectory() {
  await removeSavedRequirementsDirectory();
  savedDirHandle.value = null;
  dirName.value = '';
}

// Mode 1: PRD Extraction
async function handleExtractPrd(mode: 'directory' | 'zip') {
  if (isExtracting.value) return;
  isExtracting.value = true;
  extractionError.value = '';
  progressPercent.value = 5;
  progressMessage.value = '准备提取当前页面内容与原型图...';

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('无法连接到当前激活的网页标签');

    // If directory mode selected but not bound yet, prompt picker first
    let targetDir = savedDirHandle.value;
    if (mode === 'directory') {
      if (!isFsSupported.value) {
        throw new Error('当前浏览器不支持目录直接写入，请使用下载压缩包方式');
      }
      if (!targetDir) {
        targetDir = await pickRequirementsDirectory();
        savedDirHandle.value = targetDir;
        dirName.value = targetDir.name;
      } else {
        const hasPerm = await verifyDirectoryPermission(targetDir);
        if (!hasPerm) {
          throw new Error('未获得对本地 requirements 目录的读写授权');
        }
      }
    }

    const frameId = bestFrame.value?.bestFrameId ?? 0;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_PRD',
        saveMode: mode,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || '提取失败，请刷新目标页面后重试');
    }

    // If writing directly to directory
    if (mode === 'directory' && targetDir) {
      progressMessage.value = '正在将 Markdown 与图片写入本地 requirements 目录...';
      progressPercent.value = 95;

      await writePrdBundleToDirectory(targetDir, {
        sanitizedTitle: res.sanitizedTitle,
        markdown: res.markdown,
        assets: res.assets || [],
      });
    }

    lastPrdResult.value = {
      title: res.title,
      totalAssets: res.totalAssets,
      warnings: res.warnings || [],
      markdownPreview: res.markdownPreview,
      savedToDirectory: mode === 'directory',
      directoryName: targetDir?.name,
    };
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || String(err);
    }
  } finally {
    isExtracting.value = false;
  }
}

// Mode 2: API Extraction
async function handleExtractApi(mode: 'directory' | 'download') {
  if (isExtracting.value) return;
  isExtracting.value = true;
  extractionError.value = '';
  progressPercent.value = 5;
  progressMessage.value = '准备分析接口文档与 OpenAPI 规范...';

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error('无法连接到当前激活的网页标签');

    let targetDir = savedDirHandle.value;
    if (mode === 'directory') {
      if (!isFsSupported.value) {
        throw new Error('当前浏览器不支持目录直接写入，请使用下载 Markdown 方式');
      }
      if (!targetDir) {
        targetDir = await pickRequirementsDirectory();
        savedDirHandle.value = targetDir;
        dirName.value = targetDir.name;
      }
    }

    const frameId = bestFrame.value?.bestFrameId ?? 0;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_API',
        saveMode: mode,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || '提取失败，请刷新目标页面后重试');
    }

    if (mode === 'directory' && targetDir) {
      progressMessage.value = '正在将 API 规范写入本地 requirements 目录...';
      progressPercent.value = 95;

      await writeApiSpecToDirectory(targetDir, {
        sanitizedTitle: res.sanitizedTitle,
        markdown: res.markdown,
      });
    }

    lastApiResult.value = {
      title: res.title,
      endpointsCount: res.endpointsCount,
      format: res.format,
      markdownPreview: res.markdownPreview,
      savedToDirectory: mode === 'directory',
      directoryName: targetDir?.name,
    };
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || String(err);
    }
  } finally {
    isExtracting.value = false;
  }
}

function openSidePanel() {
  browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
  window.close();
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
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">离线提取</span>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[210px]" :title="pageTitle">
            {{ activeHost }}: {{ pageTitle }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-1.5">
        <!-- Frame piercing status badge -->
        <div
          v-if="bestFrame"
          class="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
          :class="bestFrame.totalFrames > 1 ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'"
          :title="`共检测到 ${bestFrame.totalFrames} 个框架，已自动锁定正文 frame #${bestFrame.bestFrameId}`"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>{{ bestFrame.totalFrames > 1 ? `已穿透 ${bestFrame.totalFrames} 框架` : '单框架' }}</span>
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

    <!-- Global Directory Status Bar -->
    <div class="px-4 py-2 bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-1.5 truncate">
        <FolderCheck v-if="dirName" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <HardDrive v-else class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
        <span class="text-slate-600 dark:text-slate-300 truncate">
          {{ dirName ? `工程目录: requirements (${dirName})` : '未绑定本地 requirements 目录' }}
        </span>
      </div>
      <button
        @click="currentTab = 'dir'"
        class="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0 ml-2"
      >
        {{ dirName ? '管理' : '前往设置' }}
      </button>
    </div>

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
        @click="currentTab = 'dir'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition"
        :class="currentTab === 'dir' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <FolderSync class="w-3.5 h-3.5" />
        <span>目录配置</span>
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
        <!-- Target Frame Meta Card -->
        <div v-if="bestFrame" class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-xs space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium">目标正文框架:</span>
            <span class="font-mono text-slate-700 dark:text-slate-300 font-bold">
              {{ bestFrame.bestFrameId === 0 ? 'Top Window (主窗口)' : `iframe #${bestFrame.bestFrameId}` }}
            </span>
          </div>
          <div v-if="bestFrame.platformBadge" class="flex items-center justify-between">
            <span class="text-slate-400">检测平台:</span>
            <span class="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-medium">
              {{ bestFrame.platformBadge }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-400">内容密度评分:</span>
            <span class="text-emerald-600 dark:text-emerald-400 font-semibold">{{ bestFrame.bestScore }} 分</span>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div>
            <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1 flex items-center space-x-1.5">
              <Layers class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>智能 PRD 本地化提取</span>
            </h2>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              保留当前会话鉴权态。自动穿透嵌套菜单 iframe，锁定正文框架，并发抓取高分辨率原型图并重写为本地相对路径。
            </p>
          </div>

          <!-- Action Buttons -->
          <div class="space-y-2 pt-1">
            <!-- Primary Button: Write to Directory -->
            <button
              @click="handleExtractPrd('directory')"
              :disabled="isExtracting"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99]"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? '正在处理中...' : (dirName ? `一键写入本地 requirements (${dirName})` : '写入本地 requirements 目录') }}</span>
            </button>

            <!-- Secondary Button: Download ZIP -->
            <button
              @click="handleExtractPrd('zip')"
              :disabled="isExtracting"
              class="w-full py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition"
            >
              <Download class="w-3.5 h-3.5" />
              <span>下载 PRD 压缩包 (.zip)</span>
            </button>
          </div>
        </div>

        <!-- PRD Result Card -->
        <div v-if="lastPrdResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-2">
            <CheckCircle2 class="w-4 h-4" />
            <span>{{ lastPrdResult.savedToDirectory ? `成功写入本地目录 [${lastPrdResult.directoryName}]` : '打包完成！已触发浏览器下载' }}</span>
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
              <span class="text-slate-400">落盘格式:</span>
              <span class="font-mono text-indigo-600 dark:text-indigo-400">
                {{ lastPrdResult.savedToDirectory ? '<title>.md + assets/' : '<title>-prd.zip' }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 2: API Spec Extractor -->
      <section v-if="currentTab === 'api'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div>
            <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1 flex items-center space-x-1.5">
              <Code2 class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>结构化 API 规范提取</span>
            </h2>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              优先嗅探 Swagger / OpenAPI 底层 JSON 规范直出高保真 Markdown；同时支持 Knife4j、Apifox、Redoc 深度展开与打平。
            </p>
          </div>

          <div class="space-y-2 pt-1">
            <button
              @click="handleExtractApi('directory')"
              :disabled="isExtracting"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99]"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? '正在处理中...' : (dirName ? `一键写入 requirements (${dirName})` : '写入本地 requirements 目录') }}</span>
            </button>

            <button
              @click="handleExtractApi('download')"
              :disabled="isExtracting"
              class="w-full py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition"
            >
              <Download class="w-3.5 h-3.5" />
              <span>下载 API 规范文档 (.md)</span>
            </button>
          </div>
        </div>

        <!-- API Result Card -->
        <div v-if="lastApiResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-2">
            <CheckCircle2 class="w-4 h-4" />
            <span>{{ lastApiResult.savedToDirectory ? `成功写入本地目录 [${lastApiResult.directoryName}]` : '提取完成！已生成 API Markdown' }}</span>
          </div>
          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">检测接口数:</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ lastApiResult.endpointsCount }} 个</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">解析引擎:</span>
              <span class="font-medium px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                {{ lastApiResult.format === 'openapi-spec' ? 'OpenAPI 规格引擎' : 'DOM 深度解析' }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tab 3: Local Requirements Directory Configuration -->
      <section v-if="currentTab === 'dir'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div class="flex items-center space-x-2">
            <HardDrive class="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 class="text-xs font-bold text-slate-900 dark:text-white">本地工程 requirements 目录</h2>
          </div>
          <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            绑定你本地前端项目的 <code>requirements</code> 文件夹。之后在任何需求页面点击提取，插件将直接在本地工程中生成 Markdown 与原型图，无需每次手动解压压缩包。
          </p>

          <div class="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-400">当前绑定目录:</span>
              <span class="font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                {{ dirName || '（尚未绑定）' }}
              </span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-400">浏览器支持:</span>
              <span class="flex items-center space-x-1" :class="isFsSupported ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'">
                <ShieldCheck class="w-3.5 h-3.5" />
                <span>{{ isFsSupported ? '支持原生目录直写 (Chrome / Edge)' : '不支持 (降级为 ZIP 下载)' }}</span>
              </span>
            </div>
          </div>

          <div class="flex space-x-2 pt-1">
            <button
              @click="handleSelectDirectory"
              class="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 shadow transition"
            >
              <FolderSync class="w-3.5 h-3.5" />
              <span>{{ dirName ? '重新选择目录' : '选择 requirements 文件夹' }}</span>
            </button>

            <button
              v-if="dirName"
              @click="handleClearDirectory"
              class="py-2 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium transition"
            >
              解除绑定
            </button>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div class="font-bold text-indigo-700 dark:text-indigo-300 flex items-center space-x-1">
            <Sparkles class="w-3.5 h-3.5" />
            <span>AI Coding 工作流推荐</span>
          </div>
          <p class="leading-relaxed">
            落盘至 <code>requirements/</code> 目录后，直接在 Cursor 或 Claude Code 中使用：
          </p>
          <pre class="p-2 rounded bg-white dark:bg-slate-900 font-mono text-[10px] text-slate-800 dark:text-slate-200 overflow-x-auto">@requirements/PRD-xxx.md 请根据需求文档与对应 assets/ 原型图实现此功能模块</pre>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-[11px] text-slate-400 flex items-center justify-between">
      <span>PageSpec &bull; 纯离线需求提取</span>
      <span class="font-mono text-emerald-600 dark:text-emerald-400">Zero AI Token</span>
    </footer>
  </div>
</template>
