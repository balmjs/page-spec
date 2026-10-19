<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
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
  ShieldCheck,
  Copy,
  Check,
  Languages,
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
import { t, currentLocale, toggleLocale, initLocale } from '../utils/i18n';

const props = defineProps<{
  isSidepanel?: boolean;
}>();

type ActiveTab = 'prd' | 'api' | 'dir';
export type EngineMode = 'auto' | 'tencent' | 'dom';

const currentTab = ref<ActiveTab>('prd');
const engineMode = ref<EngineMode>('auto');
const pageTitle = ref('');
const pageUrl = ref('');
const isExtracting = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const extractionError = ref('');

// Frame Detection Info
const bestFrame = ref<BestFrameResult | null>(null);
const selectedFrameId = ref<number>(0);
const isDetectingFrames = ref(false);

// Local Requirements Directory Handle
const savedDirHandle = ref<FileSystemDirectoryHandle | null>(null);
const dirName = ref<string>('');
const isFsSupported = ref(isFileSystemAccessSupported());

// Copy status
const copiedPrompt = ref(false);
const copiedMarkdown = ref(false);

// PRD Extraction Result
const lastPrdResult = ref<{
  title: string;
  sanitizedTitle: string;
  markdown: string;
  totalAssets: number;
  warnings: string[];
  markdownPreview: string;
  savedToDirectory?: boolean;
  directoryName?: string;
} | null>(null);

// API Extraction Result
const lastApiResult = ref<{
  title: string;
  sanitizedTitle: string;
  markdown: string;
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
    return t('unknownHost');
  }
});

async function refreshActiveTabContext() {
  let activeTabId: number | undefined;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      activeTabId = tabs[0].id;
      pageTitle.value = tabs[0].title || t('currentPage');
      pageUrl.value = tabs[0].url || '';
    }
  } catch (e) {
    console.error('Failed to get active tab:', e);
  }

  if (activeTabId) {
    detectFrames(activeTabId);
  }
}

function handleTabActivated() {
  refreshActiveTabContext();
}

function handleTabUpdated(_tabId: number, changeInfo: any, tab: any) {
  if (changeInfo.status === 'complete' && tab?.active) {
    refreshActiveTabContext();
  }
}

function handleRuntimeMessage(msg: any) {
  if (msg?.type === 'EXTRACTION_PROGRESS') {
    progressPercent.value = msg.current;
    progressMessage.value = msg.message;
  }
}

onMounted(async () => {
  // Initialize i18n
  await initLocale();
  if (!pageTitle.value) {
    pageTitle.value = t('detecting');
  }

  // 0. Load saved engine mode
  try {
    const stored = await browser.storage.local.get('pagespec_engine_mode');
    if (stored && stored.pagespec_engine_mode) {
      engineMode.value = stored.pagespec_engine_mode as EngineMode;
    }
  } catch (err) {
    console.warn('[PageSpec] Failed to load engine mode:', err);
  }

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
  await refreshActiveTabContext();

  // 3. Listen to tab and progress messages
  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  if (browser.tabs?.onActivated) {
    browser.tabs.onActivated.addListener(handleTabActivated);
  }
  if (browser.tabs?.onUpdated) {
    browser.tabs.onUpdated.addListener(handleTabUpdated);
  }
});

onUnmounted(() => {
  try {
    browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    if (browser.tabs?.onActivated) {
      browser.tabs.onActivated.removeListener(handleTabActivated);
    }
    if (browser.tabs?.onUpdated) {
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
    }
  } catch {
    // ignore unregister error
  }
});

watch(engineMode, (val) => {
  browser.storage.local.set({ pagespec_engine_mode: val });
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
      selectedFrameId.value = res.data.bestFrameId ?? 0;
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

// Directory Selection & Permission Preflight
async function ensureTargetDirectoryReady(): Promise<FileSystemDirectoryHandle> {
  if (!isFsSupported.value) {
    throw new Error(t('errFsUnsupported'));
  }
  let targetDir = savedDirHandle.value;
  if (!targetDir) {
    targetDir = await pickRequirementsDirectory();
    savedDirHandle.value = targetDir;
    dirName.value = targetDir.name;
  } else {
    const hasPerm = await verifyDirectoryPermission(targetDir);
    if (!hasPerm) {
      throw new Error(t('errPermDenied'));
    }
  }
  return targetDir;
}

async function handleSelectDirectory() {
  try {
    extractionError.value = '';
    const handle = await pickRequirementsDirectory();
    savedDirHandle.value = handle;
    dirName.value = handle.name;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || t('errSelectDirFailed');
    }
  }
}

async function handleClearDirectory() {
  await removeSavedRequirementsDirectory();
  savedDirHandle.value = null;
  dirName.value = '';
}

// Copy Helpers
async function copyToClipboard(text: string, type: 'prompt' | 'markdown') {
  try {
    await navigator.clipboard.writeText(text);
    if (type === 'prompt') {
      copiedPrompt.value = true;
      setTimeout(() => (copiedPrompt.value = false), 2000);
    } else {
      copiedMarkdown.value = true;
      setTimeout(() => (copiedMarkdown.value = false), 2000);
    }
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
}

// Mode 1: PRD Extraction
async function handleExtractPrd(mode: 'directory' | 'zip') {
  if (isExtracting.value) return;
  extractionError.value = '';

  let targetDir: FileSystemDirectoryHandle | null = null;
  if (mode === 'directory') {
    try {
      targetDir = await ensureTargetDirectoryReady();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        extractionError.value = err?.message || String(err);
      }
      return;
    }
  }

  isExtracting.value = true;
  progressPercent.value = 5;
  progressMessage.value = t('prepPrd');

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error(t('errNoTab'));

    const frameId = selectedFrameId.value ?? bestFrame.value?.bestFrameId ?? 0;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_PRD',
        saveMode: mode,
        engineMode: engineMode.value,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || t('errExtractFailed'));
    }

    if (mode === 'directory' && targetDir) {
      progressMessage.value = t('writingFiles');
      await writePrdBundleToDirectory(targetDir, res.data.bundle);
      lastPrdResult.value = {
        title: res.data.bundle.title,
        sanitizedTitle: res.data.bundle.sanitizedTitle,
        markdown: res.data.bundle.markdown,
        totalAssets: res.data.bundle.assets.length,
        warnings: res.data.bundle.warnings || [],
        markdownPreview: res.data.bundle.markdown.slice(0, 300) + '...',
        savedToDirectory: true,
        directoryName: targetDir.name,
      };
    } else {
      lastPrdResult.value = {
        title: res.data.title,
        sanitizedTitle: res.data.sanitizedTitle,
        markdown: res.data.markdown,
        totalAssets: res.data.totalAssets,
        warnings: res.data.warnings || [],
        markdownPreview: res.data.markdown.slice(0, 300) + '...',
        savedToDirectory: false,
      };
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || String(err);
    }
  } finally {
    isExtracting.value = false;
  }
}

// Mode 2: API Specification Extraction
async function handleExtractApi(mode: 'directory' | 'download') {
  if (isExtracting.value) return;
  extractionError.value = '';

  let targetDir: FileSystemDirectoryHandle | null = null;
  if (mode === 'directory') {
    try {
      targetDir = await ensureTargetDirectoryReady();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        extractionError.value = err?.message || String(err);
      }
      return;
    }
  }

  isExtracting.value = true;
  progressPercent.value = 5;
  progressMessage.value = t('prepPrd');

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error(t('errNoTab'));

    const frameId = selectedFrameId.value ?? bestFrame.value?.bestFrameId ?? 0;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_API',
        saveMode: mode,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || t('errExtractFailed'));
    }

    if (mode === 'directory' && targetDir) {
      progressMessage.value = t('writingFiles');
      await writeApiSpecToDirectory(targetDir, res.data.spec);
      lastApiResult.value = {
        title: res.data.spec.title,
        sanitizedTitle: res.data.spec.sanitizedTitle,
        markdown: res.data.spec.markdown,
        endpointsCount: res.data.spec.endpointsCount,
        format: res.data.spec.format,
        markdownPreview: res.data.spec.markdown.slice(0, 300) + '...',
        savedToDirectory: true,
        directoryName: targetDir.name,
      };
    } else {
      lastApiResult.value = {
        title: res.data.title,
        sanitizedTitle: res.data.sanitizedTitle,
        markdown: res.data.markdown,
        endpointsCount: res.data.endpointsCount,
        format: res.data.format,
        markdownPreview: res.data.markdown.slice(0, 300) + '...',
        savedToDirectory: false,
      };
    }
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
        <img src="/icons/icon-32.png" alt="PageSpec" class="w-7 h-7 rounded-lg shadow-sm" />
        <div>
          <div class="flex items-center space-x-1.5">
            <h1 class="text-sm font-bold tracking-tight text-slate-900 dark:text-white">PageSpec</h1>
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              {{ t('offlineBadge') }}
            </span>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]" :title="pageTitle">
            {{ activeHost }}: {{ pageTitle }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-1.5">
        <!-- Language Switcher Button -->
        <button
          type="button"
          @click="toggleLocale"
          class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition shadow-xs cursor-pointer"
          :title="t('switchLangTitle')"
        >
          <Languages class="w-3.5 h-3.5 text-indigo-500" />
          <span>{{ currentLocale === 'zh-CN' ? 'EN' : '中' }}</span>
        </button>

        <!-- Frame piercing status badge -->
        <div
          v-if="bestFrame"
          class="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
          :class="bestFrame.totalFrames > 1 ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'"
          :title="t('framesTooltip')(bestFrame.totalFrames, selectedFrameId)"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>{{ bestFrame.totalFrames > 1 ? t('framesPierced')(bestFrame.totalFrames) : t('singleFrame') }}</span>
        </div>

        <!-- Open SidePanel Button -->
        <button
          v-if="!props.isSidepanel"
          @click="openSidePanel"
          class="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition"
          :title="t('openInSidePanel')"
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
          {{ dirName ? t('boundDir')(dirName) : t('unboundDir') }}
        </span>
      </div>
      <button
        @click="currentTab = 'dir'"
        class="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0 ml-2 cursor-pointer"
      >
        {{ dirName ? t('manageDir') : t('setupDir') }}
      </button>
    </div>

    <!-- Navigation Tabs -->
    <nav class="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 px-3 pt-2">
      <button
        @click="currentTab = 'prd'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition cursor-pointer"
        :class="currentTab === 'prd' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <FolderArchive class="w-3.5 h-3.5" />
        <span>{{ t('prdTab') }}</span>
      </button>

      <button
        @click="currentTab = 'api'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition cursor-pointer"
        :class="currentTab === 'api' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <Code2 class="w-3.5 h-3.5" />
        <span>{{ t('apiTab') }}</span>
      </button>

      <button
        @click="currentTab = 'dir'"
        class="flex items-center space-x-1.5 pb-2 px-3 border-b-2 text-xs font-semibold transition cursor-pointer"
        :class="currentTab === 'dir' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'"
      >
        <FolderSync class="w-3.5 h-3.5" />
        <span>{{ t('dirTab') }}</span>
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
            <span>{{ progressMessage || t('processing') }}</span>
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
        <div v-if="bestFrame" class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium">{{ t('targetBodyFrame') }}</span>
            <span class="font-mono text-slate-700 dark:text-slate-300 font-bold">
              {{ selectedFrameId === 0 ? t('topWindow') : `iframe #${selectedFrameId}` }}
            </span>
          </div>

          <!-- Manual Frame Selector if multiple frames exist -->
          <div v-if="bestFrame.frames && bestFrame.frames.length > 1" class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <span class="text-slate-400">{{ t('switchFrame') }}</span>
            <select
              v-model="selectedFrameId"
              class="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[210px] truncate"
            >
              <option v-for="f in bestFrame.frames" :key="f.frameId" :value="f.frameId">
                #{{ f.frameId }} {{ f.isTopFrame ? `(${t('topWindow')})` : '' }} {{ f.title ? `- ${f.title.slice(0, 15)}` : '' }} ({{ f.score }}{{ t('scoreUnit') }})
              </option>
            </select>
          </div>

          <div v-if="bestFrame.platformBadge" class="flex items-center justify-between">
            <span class="text-slate-400">{{ t('detectedPlatform') }}</span>
            <span class="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-medium">
              {{ bestFrame.platformBadge }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-400">{{ t('contentDensity') }}</span>
            <span class="text-emerald-600 dark:text-emerald-400 font-semibold">{{ bestFrame.bestScore }} {{ t('scoreUnit') }}</span>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div>
            <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1 flex items-center space-x-1.5">
              <Layers class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{{ t('smartPrdTitle') }}</span>
            </h2>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {{ t('smartPrdDesc') }}
            </p>
          </div>

          <!-- Engine Selector -->
          <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-xs">
            <span class="text-slate-500 dark:text-slate-400 font-medium flex items-center space-x-1.5">
              <Sparkles class="w-3.5 h-3.5 text-indigo-500" />
              <span>{{ t('parseEngine') }}</span>
            </span>
            <select
              v-model="engineMode"
              class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="auto">{{ t('engineAuto') }}</option>
              <option value="tencent">{{ t('engineTencent') }}</option>
              <option value="dom">{{ t('engineDom') }}</option>
            </select>
          </div>

          <!-- Action Buttons -->
          <div class="space-y-2 pt-1">
            <button
              @click="handleExtractPrd('directory')"
              :disabled="isExtracting"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99] cursor-pointer"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? t('processing') : t('btnWriteDir')(dirName) }}</span>
            </button>

            <button
              @click="handleExtractPrd('zip')"
              :disabled="isExtracting"
              class="w-full py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <Download class="w-3.5 h-3.5" />
              <span>{{ t('btnDownloadZip') }}</span>
            </button>
          </div>
        </div>

        <!-- PRD Result Card -->
        <div v-if="lastPrdResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm space-y-3">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
            <CheckCircle2 class="w-4 h-4" />
            <span>{{ lastPrdResult.savedToDirectory ? t('successWrite')(lastPrdResult.directoryName || '') : t('successDownload') }}</span>
          </div>

          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('docTitle') }}</span>
              <span class="font-medium truncate max-w-[200px]">{{ lastPrdResult.title }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('localizedAssets') }}</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ t('assetsCount')(lastPrdResult.totalAssets) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('isolatedPath') }}</span>
              <span class="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">
                assets/{{ lastPrdResult.sanitizedTitle }}/
              </span>
            </div>
          </div>

          <!-- Warnings Box if any -->
          <div v-if="lastPrdResult.warnings && lastPrdResult.warnings.length > 0" class="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 text-[11px] space-y-1">
            <div class="font-semibold flex items-center space-x-1">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ t('downgradeNotice')(lastPrdResult.warnings.length) }}</span>
            </div>
            <ul class="list-disc list-inside max-h-24 overflow-y-auto space-y-0.5">
              <li v-for="(w, idx) in lastPrdResult.warnings" :key="idx" class="truncate">{{ w }}</li>
            </ul>
          </div>

          <!-- Quick Action Buttons: Copy Prompt & Markdown -->
          <div class="flex space-x-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <button
              @click="copyToClipboard(t('aiPromptPrd')(lastPrdResult.sanitizedTitle), 'prompt')"
              class="flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedPrompt" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedPrompt ? t('copiedPrompt') : t('copyPrompt') }}</span>
            </button>

            <button
              @click="copyToClipboard(lastPrdResult.markdown, 'markdown')"
              class="py-1.5 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedMarkdown" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedMarkdown ? t('copiedMarkdown') : t('copyFullMarkdown') }}</span>
            </button>
          </div>

          <!-- Markdown Preview Collapsible -->
          <details class="text-xs pt-1">
            <summary class="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium select-none hover:underline">
              {{ t('viewMarkdownPreview') }}
            </summary>
            <pre class="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">{{ lastPrdResult.markdownPreview }}</pre>
          </details>
        </div>
      </section>

      <!-- Tab 2: API Spec Extractor -->
      <section v-if="currentTab === 'api'" class="space-y-4">
        <!-- Target Frame Meta Card -->
        <div v-if="bestFrame" class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium">{{ t('targetApiFrame') }}</span>
            <span class="font-mono text-slate-700 dark:text-slate-300 font-bold">
              {{ selectedFrameId === 0 ? t('topWindow') : `iframe #${selectedFrameId}` }}
            </span>
          </div>

          <div v-if="bestFrame.frames && bestFrame.frames.length > 1" class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <span class="text-slate-400">{{ t('switchFrame') }}</span>
            <select
              v-model="selectedFrameId"
              class="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[210px] truncate"
            >
              <option v-for="f in bestFrame.frames" :key="f.frameId" :value="f.frameId">
                #{{ f.frameId }} {{ f.isTopFrame ? `(${t('topWindow')})` : '' }} {{ f.title ? `- ${f.title.slice(0, 15)}` : '' }} ({{ f.score }}{{ t('scoreUnit') }})
              </option>
            </select>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div>
            <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1 flex items-center space-x-1.5">
              <Code2 class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{{ t('structuredApiTitle') }}</span>
            </h2>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {{ t('structuredApiDesc') }}
            </p>
          </div>

          <div class="space-y-2 pt-1">
            <button
              @click="handleExtractApi('directory')"
              :disabled="isExtracting"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99] cursor-pointer"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? t('processing') : t('btnWriteApiDir')(dirName) }}</span>
            </button>

            <button
              @click="handleExtractApi('download')"
              :disabled="isExtracting"
              class="w-full py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <Download class="w-3.5 h-3.5" />
              <span>{{ t('btnDownloadApiMd') }}</span>
            </button>
          </div>
        </div>

        <!-- API Result Card -->
        <div v-if="lastApiResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm space-y-3">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
            <CheckCircle2 class="w-4 h-4" />
            <span>{{ lastApiResult.savedToDirectory ? t('successApiWrite')(lastApiResult.directoryName || '') : t('successApiDownload') }}</span>
          </div>

          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('detectedEndpoints') }}</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ t('endpointsCount')(lastApiResult.endpointsCount) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('parseEngine') }}</span>
              <span class="font-medium px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                {{ lastApiResult.format === 'openapi-spec' ? t('openapiEngine') : t('domEngine') }}
              </span>
            </div>
          </div>

          <!-- Quick Action Buttons -->
          <div class="flex space-x-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <button
              @click="copyToClipboard(t('aiPromptApi')(lastApiResult.sanitizedTitle), 'prompt')"
              class="flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedPrompt" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedPrompt ? t('copiedPrompt') : t('copyPrompt') }}</span>
            </button>

            <button
              @click="copyToClipboard(lastApiResult.markdown, 'markdown')"
              class="py-1.5 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedMarkdown" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedMarkdown ? t('copiedMarkdown') : t('copyFullMarkdown') }}</span>
            </button>
          </div>

          <details class="text-xs pt-1">
            <summary class="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium select-none hover:underline">
              {{ t('viewMarkdownPreview') }}
            </summary>
            <pre class="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">{{ lastApiResult.markdownPreview }}</pre>
          </details>
        </div>
      </section>

      <!-- Tab 3: Local Requirements Directory Configuration -->
      <section v-if="currentTab === 'dir'" class="space-y-4">
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div class="flex items-center space-x-2">
            <HardDrive class="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 class="text-xs font-bold text-slate-900 dark:text-white">{{ t('localDirTitle') }}</h2>
          </div>
          <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {{ t('localDirDesc') }}
          </p>

          <div class="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-400">{{ t('currentBinding') }}</span>
              <span class="font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                {{ dirName || t('unbound') }}
              </span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-400">{{ t('browserSupport') }}</span>
              <span class="flex items-center space-x-1" :class="isFsSupported ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'">
                <ShieldCheck class="w-3.5 h-3.5" />
                <span>{{ isFsSupported ? t('fsSupportedText') : t('fsUnsupportedText') }}</span>
              </span>
            </div>
          </div>

          <div class="flex space-x-2 pt-1">
            <button
              @click="handleSelectDirectory"
              class="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 shadow transition cursor-pointer"
            >
              <FolderSync class="w-3.5 h-3.5" />
              <span>{{ dirName ? t('btnReSelectDir') : t('btnSelectDir') }}</span>
            </button>

            <button
              v-if="dirName"
              @click="handleClearDirectory"
              class="py-2 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium transition cursor-pointer"
            >
              {{ t('btnUnbind') }}
            </button>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div class="font-bold text-indigo-700 dark:text-indigo-300 flex items-center space-x-1">
            <Sparkles class="w-3.5 h-3.5" />
            <span>{{ t('workflowTitle') }}</span>
          </div>
          <p class="leading-relaxed">
            {{ t('workflowDesc') }}
          </p>
          <pre class="p-2 rounded bg-white dark:bg-slate-900 font-mono text-[10px] text-slate-800 dark:text-slate-200 overflow-x-auto">@requirements/PRD-xxx.md {{ t('aiPromptPrd')('PRD-xxx').split(' ')[1] || 'Please implement this feature module based on the requirement specification and prototype assets' }}</pre>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-[11px] text-slate-400 flex items-center justify-between">
      <span>{{ t('footerTitle') }}</span>
      <span class="font-mono text-emerald-600 dark:text-emerald-400">{{ t('zeroToken') }}</span>
    </footer>
  </div>
</template>
