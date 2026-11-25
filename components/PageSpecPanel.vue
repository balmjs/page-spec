<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import {
  FolderArchive,
  Palette,
  Code2,
  FolderSync,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  FolderCheck,
  HardDrive,
  Sparkles,
  ShieldCheck,
  Copy,
  Check,
  Languages,
  Link2,
  Bug,
  Unlink,
  CloudDownload,
} from 'lucide-vue-next';
import {
  isFileSystemAccessSupported,
  pickRequirementsDirectory,
  getSavedRequirementsDirectory,
  removeSavedRequirementsDirectory,
  writePrdBundleToDirectory,
  writeDesignBundleToDirectory,
  writeApiSpecToDirectory,
  overwriteMarkdownInDirectory,
  verifyDirectoryPermission,
  getSpecsRootSettings,
  getEffectiveSpecsRootDir,
  saveSpecsRootDir,
  clearProjectSpecsRootOverride,
  validateSpecsRootDir,
  inspectSpecsRootConflict,
  DEFAULT_SPECS_ROOT_DIR,
  SPECS_ROOT_PRESETS,
  GLOBAL_ROOT_DIR_STORAGE_KEY,
  PROJECT_ROOT_OVERRIDES_STORAGE_KEY,
  type SerializableAsset,
  type SpecsRootSettings,
  type SpecsRootConflictReport,
} from '../utils/filesystem-writer';
import type { BestFrameResult } from '../entrypoints/background';
import type { SpecDiffResult } from '../utils/spec-diff';
import type { ApiEndpointSummary } from '../core/extractors/api-extractor';
import type { DesignArtboardSummary, DesignPlatform } from '../core/extractors/design-extractor';
import {
  getSpecLoopConfig,
  saveSpecLoopConfig,
  disconnectSpecLoop,
  isSpecLoopConnected,
  normalizeSpecLoopBaseUrl,
  startSpecLoopAuthHandshake,
  verifySpecLoopConnection,
  fetchSpecLoopProjects,
  fetchSpecLoopTasks,
  pushSpecBundleToSpecLoop,
  createSpecBundleManifest,
  PAGESPEC_VERSION,
  type SpecLoopConfig,
  type SpecLoopProjectSummary,
  type SpecLoopTaskSummary,
} from '../utils/specloop-bridge';
import { pullTaskFullSpecsToLocal } from '../utils/specloop-puller';
import { t, currentLocale, toggleLocale, initLocale } from '../utils/i18n';
import DiffBadgeBox from './DiffBadgeBox.vue';
import SectionTrimmerBox from './SectionTrimmerBox.vue';
import SpecLoopActionBar from './SpecLoopActionBar.vue';
import SpecLoopTaskPicker from './SpecLoopTaskPicker.vue';
import QaCompanionPanel from './QaCompanionPanel.vue';
import ApiEndpointSelector from './ApiEndpointSelector.vue';
import DesignArtboardSelector from './DesignArtboardSelector.vue';

const props = defineProps<{
  isSidepanel?: boolean;
}>();

type ActiveTab = 'prd' | 'design' | 'api' | 'qa' | 'dir';
export type EngineMode = 'auto' | 'tencent' | 'dom';

const ACTIVE_TAB_STORAGE_KEY = 'pagespec_active_tab';
const VALID_TABS: ReadonlySet<ActiveTab> = new Set(['prd', 'design', 'api', 'qa', 'dir']);

function parseStoredTab(raw: unknown): ActiveTab | null {
  return typeof raw === 'string' && VALID_TABS.has(raw as ActiveTab) ? (raw as ActiveTab) : null;
}

function readCachedTabSync(): ActiveTab {
  try {
    return parseStoredTab(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)) ?? 'prd';
  } catch {
    return 'prd';
  }
}

function writeCachedTabSync(tab: ActiveTab) {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // ignore storage errors
  }
}

function persistActiveTab(tab: ActiveTab) {
  writeCachedTabSync(tab);
  browser.storage.local.set({ [ACTIVE_TAB_STORAGE_KEY]: tab }).catch(() => {});
}

const currentTab = ref<ActiveTab>(readCachedTabSync());
const isHydrated = ref(false);
const tabListRef = ref<HTMLElement | null>(null);
const engineMode = ref<EngineMode>('auto');
const autoTrimNoise = ref(true);
const pageTitle = ref('');
const pageUrl = ref('');
const isExtracting = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');
const extractionError = ref('');

// Frame Detection Info
const bestFrame = ref<BestFrameResult | null>(null);
const selectedFrameId = ref<number>(0);
const designFrameId = ref<number>(0);
const isDetectingFrames = ref(false);

// Local Project Root Directory Handle & Customizable Specs Root Strategy
const savedDirHandle = ref<FileSystemDirectoryHandle | null>(null);
const dirName = ref<string>('');
const isFsSupported = ref(isFileSystemAccessSupported());
const specsRootSettings = ref<SpecsRootSettings>({
  defaultRootDir: DEFAULT_SPECS_ROOT_DIR,
  projectOverrides: {},
});
const specsRootInput = ref<string>(DEFAULT_SPECS_ROOT_DIR);
const specsRootTouched = ref(false);
const specsRootAnnouncement = ref('');
const specsRootConflict = ref<SpecsRootConflictReport | null>(null);

const effectiveSpecsRootDir = computed(() =>
  getEffectiveSpecsRootDir(dirName.value || undefined, specsRootSettings.value)
);

const isProjectOverrideActive = computed(() =>
  Boolean(dirName.value && specsRootSettings.value.projectOverrides[dirName.value])
);

const specsRootValidation = computed(() => validateSpecsRootDir(specsRootInput.value));
const showSpecsRootError = computed(
  () => specsRootTouched.value && !specsRootValidation.value.valid
);

const specsRootErrorText = computed(() => {
  switch (specsRootValidation.value.errorCode) {
    case 'absolute':
      return t('specsRootErrAbsolute');
    case 'traversal':
      return t('specsRootErrTraversal');
    case 'reserved_segment':
      return t('specsRootErrReserved');
    default:
      return t('specsRootErrInvalidChars');
  }
});

const previewSpecsPath = computed(() => {
  const root = specsRootValidation.value.valid
    ? specsRootValidation.value.normalized
    : effectiveSpecsRootDir.value;
  if (!dirName.value) {
    return `${root}/{prd,design,api,qa}`;
  }
  const segments = root.split('/');
  const lastSeg = segments[segments.length - 1] || DEFAULT_SPECS_ROOT_DIR;
  if (dirName.value.toLowerCase() === lastSeg.toLowerCase()) {
    return `${dirName.value}/{prd,design,api,qa}`;
  }
  return `${dirName.value}/${root}/{prd,design,api,qa}`;
});

// SpecLoop Optional Config & Dynamic Data
const specLoopConfig = ref<SpecLoopConfig>({
  baseUrl: '',
  apiToken: '',
  defaultTaskId: '',
  defaultProjectId: '',
  userEmail: '',
  userDisplayName: '',
});
const specLoopSaved = ref(false);
const specLoopConnError = ref('');
const specLoopProjects = ref<SpecLoopProjectSummary[]>([]);
const specLoopTasks = ref<SpecLoopTaskSummary[]>([]);
const isLoadingSpecLoopTasks = ref(false);

// Opt-in SpecLoop Sync Checkboxes — STRICTLY DEFAULT FALSE (preserving standalone open-source purity!)
const syncPrdToSpecLoop = ref(false);
const syncDesignToSpecLoop = ref(false);
const syncApiToSpecLoop = ref(false);
const syncTargetTaskId = ref('');
const syncDesignSectionAnchor = ref('');

// Reverse Pull State (in Settings)
const pullTaskId = ref('');
const isPullingSpecs = ref(false);
const pullSpecsMsg = ref('');
const pullSpecsPrompt = ref('');

// Copy status
const copiedPrompt = ref(false);
const copiedMarkdown = ref(false);

// Design Artboard Scanner State
const isScanningArtboards = ref(false);
const designPlatform = ref<DesignPlatform>('generic-design');
const designArtboards = ref<DesignArtboardSummary[]>([]);
const selectedArtboardIds = ref<string[]>([]);
const designColorTokens = ref<string[]>([]);
const designAnnotationsCount = ref(0);

// API Endpoint Scanner State
const isScanningEndpoints = ref(false);
const apiEndpoints = ref<ApiEndpointSummary[]>([]);
const selectedEndpointKeys = ref<string[]>([]);

// PRD Extraction Result
const lastPrdResult = ref<{
  title: string;
  sanitizedTitle: string;
  rawMarkdown: string;
  markdown: string;
  assets: SerializableAsset[];
  totalAssets: number;
  trimmedHeadings: string[];
  warnings: string[];
  markdownPreview: string;
  savedToDirectory?: boolean;
  displayRelativeDir?: string;
  relativeMdPath?: string;
  diffFilename?: string;
  diffSummary?: SpecDiffResult;
  specLoopSyncNotice?: string;
} | null>(null);

// Design Extraction Result
const lastDesignResult = ref<{
  title: string;
  sanitizedTitle: string;
  platform: DesignPlatform;
  rawMarkdown: string;
  markdown: string;
  assets: SerializableAsset[];
  totalAssets: number;
  artboardsCount: number;
  warnings: string[];
  markdownPreview: string;
  savedToDirectory?: boolean;
  displayRelativeDir?: string;
  relativeMdPath?: string;
  diffFilename?: string;
  diffSummary?: SpecDiffResult;
  specLoopSyncNotice?: string;
} | null>(null);

// API Extraction Result
const lastApiResult = ref<{
  title: string;
  sanitizedTitle: string;
  rawMarkdown: string;
  markdown: string;
  endpointsCount: number;
  format: string;
  markdownPreview: string;
  savedToDirectory?: boolean;
  displayRelativeDir?: string;
  relativeMdPath?: string;
  diffFilename?: string;
  diffSummary?: SpecDiffResult;
  specLoopSyncNotice?: string;
} | null>(null);

const specLoopConnected = computed(() => isSpecLoopConnected(specLoopConfig.value));

const visibleTabs = computed(() => {
  const tabs: Array<{ id: ActiveTab; label: string; icon: any }> = [
    { id: 'prd', label: t('prdTab'), icon: FolderArchive },
    { id: 'design', label: t('designTab'), icon: Palette },
    { id: 'api', label: t('apiTab'), icon: Code2 },
  ];
  if (specLoopConnected.value) {
    tabs.push({ id: 'qa', label: t('qaTab'), icon: Bug });
  }
  tabs.push({ id: 'dir', label: t('dirTab'), icon: FolderSync });
  return tabs;
});

function handleTabListKeydown(e: KeyboardEvent) {
  const tabs = Array.from(
    tabListRef.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []
  );
  if (tabs.length === 0) return;
  const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1) return;

  let nextIndex: number | null = null;
  if (e.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (e.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (e.key === 'Home') {
    nextIndex = 0;
  } else if (e.key === 'End') {
    nextIndex = tabs.length - 1;
  }

  if (nextIndex !== null) {
    e.preventDefault();
    tabs[nextIndex]?.focus();
  }
}

const activeHost = computed(() => {
  try {
    return new URL(pageUrl.value).hostname;
  } catch {
    return t('unknownHost');
  }
});

const prdManifest = computed(() => {
  if (!lastPrdResult.value) return null;
  return createSpecBundleManifest({
    type: 'prd',
    title: lastPrdResult.value.title,
    sanitizedTitle: lastPrdResult.value.sanitizedTitle,
    sourceUrl: pageUrl.value,
    markdownFile: `${lastPrdResult.value.sanitizedTitle}.md`,
    diffFile: lastPrdResult.value.diffFilename,
    assetsCount: lastPrdResult.value.totalAssets,
  });
});

const designManifest = computed(() => {
  if (!lastDesignResult.value) return null;
  return createSpecBundleManifest({
    type: 'design',
    title: lastDesignResult.value.title,
    sanitizedTitle: lastDesignResult.value.sanitizedTitle,
    sourceUrl: pageUrl.value,
    markdownFile: `${lastDesignResult.value.sanitizedTitle}.md`,
    diffFile: lastDesignResult.value.diffFilename,
    assetsCount: lastDesignResult.value.totalAssets,
    artboardsCount: lastDesignResult.value.artboardsCount,
    platform: lastDesignResult.value.platform,
  });
});

const apiManifest = computed(() => {
  if (!lastApiResult.value) return null;
  return createSpecBundleManifest({
    type: 'api',
    title: lastApiResult.value.title,
    sanitizedTitle: lastApiResult.value.sanitizedTitle,
    sourceUrl: pageUrl.value,
    markdownFile: `${lastApiResult.value.sanitizedTitle}.md`,
    diffFile: lastApiResult.value.diffFilename,
    assetsCount: 0,
    endpointsCount: lastApiResult.value.endpointsCount,
  });
});

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function refreshSpecLoopWorkspaceData() {
  if (!specLoopConnected.value) {
    specLoopProjects.value = [];
    specLoopTasks.value = [];
    return;
  }
  isLoadingSpecLoopTasks.value = true;
  try {
    const [projRes, taskRes] = await Promise.all([
      fetchSpecLoopProjects(specLoopConfig.value),
      fetchSpecLoopTasks(specLoopConfig.value),
    ]);
    if (projRes.ok) {
      specLoopProjects.value = projRes.projects;
    }
    if (taskRes.ok) {
      specLoopTasks.value = taskRes.tasks;
      if (!pullTaskId.value && taskRes.tasks.length > 0) {
        pullTaskId.value = taskRes.tasks[0]!.id;
      }
    }
  } finally {
    isLoadingSpecLoopTasks.value = false;
  }
}

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
    await detectFrames(activeTabId);
    if (currentTab.value === 'design') {
      scanDesignArtboards(activeTabId);
    } else if (currentTab.value === 'api') {
      scanApiEndpoints(activeTabId);
    }
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
  } else if (msg?.type === 'SPECLOOP_CONFIG_UPDATED' && msg.config) {
    specLoopConfig.value = { ...specLoopConfig.value, ...msg.config };
    specLoopConnError.value = '';
    refreshSpecLoopWorkspaceData();
  }
}

async function refreshSpecsRootConflict(overrideDir?: string) {
  if (!savedDirHandle.value) {
    specsRootConflict.value = null;
    return;
  }
  const targetDir = overrideDir ?? effectiveSpecsRootDir.value;
  specsRootConflict.value = await inspectSpecsRootConflict(savedDirHandle.value, targetDir);
}

function handleSpecsRootInput() {
  if (specsRootValidation.value.valid) {
    specsRootAnnouncement.value = '';
  }
}

async function commitSpecsRootInput() {
  specsRootTouched.value = true;
  const check = specsRootValidation.value;
  if (!check.valid) {
    specsRootAnnouncement.value = `${t('specsRootLabel')}: ${specsRootErrorText.value}`;
    return;
  }
  specsRootAnnouncement.value = '';
  specsRootInput.value = check.normalized;
  specsRootSettings.value = await saveSpecsRootDir(check.normalized, dirName.value || undefined);
  await refreshSpecsRootConflict(check.normalized);
}

async function applySpecsRootPreset(preset: string) {
  specsRootInput.value = preset;
  specsRootTouched.value = false;
  specsRootAnnouncement.value = '';
  specsRootSettings.value = await saveSpecsRootDir(preset, dirName.value || undefined);
  await refreshSpecsRootConflict(preset);
}

async function handleResetProjectSpecsRoot() {
  if (!dirName.value) return;
  specsRootSettings.value = await clearProjectSpecsRootOverride(dirName.value);
  specsRootInput.value = effectiveSpecsRootDir.value;
  specsRootTouched.value = false;
  specsRootAnnouncement.value = '';
  await refreshSpecsRootConflict();
}

function handleStorageChanged(
  changes: Record<string, { newValue?: unknown }>,
  areaName: string
) {
  if (areaName !== 'local') return;
  const nextTab = parseStoredTab(changes[ACTIVE_TAB_STORAGE_KEY]?.newValue);
  if (nextTab && nextTab !== currentTab.value) {
    if (nextTab === 'qa' && !specLoopConnected.value) return;
    currentTab.value = nextTab;
    writeCachedTabSync(nextTab);
  }
  if (changes[GLOBAL_ROOT_DIR_STORAGE_KEY] || changes[PROJECT_ROOT_OVERRIDES_STORAGE_KEY]) {
    getSpecsRootSettings().then((settings) => {
      specsRootSettings.value = settings;
      specsRootInput.value = effectiveSpecsRootDir.value;
      specsRootTouched.value = false;
      refreshSpecsRootConflict();
    });
  }
}

onMounted(async () => {
  const [, stored, rootSettings, slConfig, savedHandle] = await Promise.all([
    initLocale(),
    browser.storage.local
      .get(['pagespec_engine_mode', 'pagespec_auto_trim_noise', ACTIVE_TAB_STORAGE_KEY])
      .catch((err) => {
        console.warn('[PageSpec] Failed to load preferences:', err);
        return {} as Record<string, any>;
      }),
    getSpecsRootSettings(),
    getSpecLoopConfig(),
    getSavedRequirementsDirectory().catch((err) => {
      console.warn('[PageSpec] Failed to load saved directory handle:', err);
      return null;
    }),
  ]);

  if (!pageTitle.value) {
    pageTitle.value = t('detecting');
  }

  if (stored?.pagespec_engine_mode) {
    engineMode.value = stored.pagespec_engine_mode as EngineMode;
  }
  if (typeof stored?.pagespec_auto_trim_noise === 'boolean') {
    autoTrimNoise.value = stored.pagespec_auto_trim_noise;
  }

  specsRootSettings.value = rootSettings;
  specLoopConfig.value = slConfig;
  syncTargetTaskId.value = slConfig.defaultTaskId || '';

  if (savedHandle) {
    savedDirHandle.value = savedHandle;
    dirName.value = savedHandle.name;
  }
  specsRootInput.value = effectiveSpecsRootDir.value;

  const storedTab = parseStoredTab(stored?.[ACTIVE_TAB_STORAGE_KEY]);
  if (storedTab) {
    currentTab.value = storedTab;
  }
  if (currentTab.value === 'qa' && !specLoopConnected.value) {
    currentTab.value = 'prd';
    persistActiveTab('prd');
  } else {
    writeCachedTabSync(currentTab.value);
  }

  await nextTick();
  isHydrated.value = true;

  if (savedDirHandle.value) {
    refreshSpecsRootConflict();
  }

  if (specLoopConnected.value) {
    refreshSpecLoopWorkspaceData();
  }

  await refreshActiveTabContext();

  browser.runtime.onMessage.addListener(handleRuntimeMessage);
  browser.storage?.onChanged?.addListener(handleStorageChanged);
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
    browser.storage?.onChanged?.removeListener(handleStorageChanged);
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
  if (!isHydrated.value) return;
  browser.storage.local.set({ pagespec_engine_mode: val });
});

watch(autoTrimNoise, (val) => {
  if (!isHydrated.value) return;
  browser.storage.local.set({ pagespec_auto_trim_noise: val });
});

watch(currentTab, async (tab) => {
  if (!isHydrated.value) return;
  persistActiveTab(tab);
  extractionError.value = '';
  if (tab === 'design') {
    await scanDesignArtboards();
  } else if (tab === 'api') {
    await scanApiEndpoints();
  } else if (tab === 'qa' && specLoopConnected.value) {
    await refreshSpecLoopWorkspaceData();
  }
});

watch(selectedFrameId, () => {
  if (currentTab.value === 'api') {
    scanApiEndpoints();
  }
});

watch(designFrameId, () => {
  if (currentTab.value === 'design') {
    scanDesignArtboards();
  }
});

watch(specLoopConnected, (isConn) => {
  if (!isHydrated.value) return;
  if (!isConn && currentTab.value === 'qa') {
    currentTab.value = 'prd';
  }
  if (!isConn) {
    syncPrdToSpecLoop.value = false;
    syncDesignToSpecLoop.value = false;
    syncApiToSpecLoop.value = false;
  }
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
      designFrameId.value = 0;
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

async function scanDesignArtboards(explicitTabId?: number) {
  isScanningArtboards.value = true;
  try {
    const tabId = explicitTabId || (await getActiveTabId());
    if (!tabId) return;
    const res: any = await browser.tabs.sendMessage(
      tabId,
      { type: 'LIST_DESIGN_ARTBOARDS' },
      { frameId: designFrameId.value }
    );
    if (res && res.ok && res.data) {
      designPlatform.value = res.data.platform;
      designArtboards.value = res.data.artboards || [];
      selectedArtboardIds.value = designArtboards.value.map((a) => a.id);
      designColorTokens.value = res.data.colorTokens || [];
      designAnnotationsCount.value = (res.data.pageAnnotations || []).length;
    } else {
      designArtboards.value = [];
      selectedArtboardIds.value = [];
    }
  } catch {
    designArtboards.value = [];
    selectedArtboardIds.value = [];
  } finally {
    isScanningArtboards.value = false;
  }
}

async function scanApiEndpoints(explicitTabId?: number) {
  isScanningEndpoints.value = true;
  try {
    const tabId = explicitTabId || (await getActiveTabId());
    if (!tabId) return;
    const frameId = selectedFrameId.value ?? bestFrame.value?.bestFrameId ?? 0;
    const res: any = await browser.tabs.sendMessage(
      tabId,
      { type: 'LIST_API_ENDPOINTS' },
      { frameId }
    );
    if (res && res.ok && res.data) {
      apiEndpoints.value = res.data.endpoints || [];
      selectedEndpointKeys.value = apiEndpoints.value.map((e) => e.key);
    } else {
      apiEndpoints.value = [];
      selectedEndpointKeys.value = [];
    }
  } catch {
    apiEndpoints.value = [];
    selectedEndpointKeys.value = [];
  } finally {
    isScanningEndpoints.value = false;
  }
}

async function ensureTargetDirectoryReady(): Promise<FileSystemDirectoryHandle> {
  if (!isFsSupported.value) {
    throw new Error(t('errFsUnsupported'));
  }
  let targetDir = savedDirHandle.value;
  if (!targetDir) {
    targetDir = await pickRequirementsDirectory();
    savedDirHandle.value = targetDir;
    dirName.value = targetDir.name;
    specsRootInput.value = effectiveSpecsRootDir.value;
    specsRootTouched.value = false;
    specsRootAnnouncement.value = '';
    refreshSpecsRootConflict();
  } else {
    const hasPerm = await verifyDirectoryPermission(targetDir);
    if (!hasPerm) {
      throw new Error(t('errPermDenied'));
    }
    refreshSpecsRootConflict();
  }
  return targetDir;
}

async function handleSelectDirectory() {
  try {
    extractionError.value = '';
    const handle = await pickRequirementsDirectory();
    savedDirHandle.value = handle;
    dirName.value = handle.name;
    specsRootInput.value = effectiveSpecsRootDir.value;
    specsRootTouched.value = false;
    specsRootAnnouncement.value = '';
    await refreshSpecsRootConflict();
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
  specsRootInput.value = effectiveSpecsRootDir.value;
  specsRootTouched.value = false;
  specsRootAnnouncement.value = '';
  specsRootConflict.value = null;
}

async function handleConnectSpecLoop() {
  specLoopConnError.value = '';
  const url = specLoopConfig.value.baseUrl.trim();
  if (!url) {
    specLoopConnError.value = '请先输入 SpecLoop 服务地址';
    return;
  }
  const normalized = normalizeSpecLoopBaseUrl(url);
  if (!normalized) {
    specLoopConnError.value = '服务地址格式无效，请输入如 http://localhost:8080 或 https://specloop.yourdomain.com';
    return;
  }
  specLoopConfig.value.baseUrl = normalized.baseUrl;
  // Save BEFORE opening the new tab, because Chrome closes the popup immediately on tabs.create()
  await saveSpecLoopConfig(specLoopConfig.value);
  const res = await startSpecLoopAuthHandshake(normalized.baseUrl);
  if (!res.ok) {
    specLoopConnError.value = res.error || '无法打开授权页';
  }
}

async function handleSaveSpecLoopConfig() {
  specLoopConnError.value = '';
  await saveSpecLoopConfig(specLoopConfig.value);
  if (specLoopConnected.value) {
    const verify = await verifySpecLoopConnection(specLoopConfig.value);
    if (verify.ok) {
      specLoopConfig.value.userEmail = verify.email || specLoopConfig.value.userEmail;
      specLoopConfig.value.userDisplayName = verify.displayName || specLoopConfig.value.userDisplayName;
      await saveSpecLoopConfig(specLoopConfig.value);
      await refreshSpecLoopWorkspaceData();
    } else {
      specLoopConnError.value = verify.error || 'Token 校验未通过';
      return;
    }
  }
  specLoopSaved.value = true;
  setTimeout(() => (specLoopSaved.value = false), 2200);
}

async function handleDisconnectSpecLoop() {
  specLoopConfig.value = await disconnectSpecLoop();
  specLoopProjects.value = [];
  specLoopTasks.value = [];
  specLoopConnError.value = '';
}

async function handlePullFullSpecs() {
  if (!pullTaskId.value || isPullingSpecs.value) return;
  pullSpecsMsg.value = '';
  pullSpecsPrompt.value = '';
  extractionError.value = '';
  let targetDir: FileSystemDirectoryHandle;
  try {
    targetDir = await ensureTargetDirectoryReady();
  } catch (err: any) {
    if (err.name !== 'AbortError') extractionError.value = err?.message || String(err);
    return;
  }

  isPullingSpecs.value = true;
  try {
    const res = await pullTaskFullSpecsToLocal({
      dirHandle: targetDir,
      config: specLoopConfig.value,
      taskId: pullTaskId.value,
      specsRootDir: effectiveSpecsRootDir.value,
    });
    if (!res.ok) {
      extractionError.value = res.error || '同步失败';
    } else {
      pullSpecsMsg.value = t('pullSpecsSuccess')(
        res.writtenPaths.length,
        res.resolvedRootName || effectiveSpecsRootDir.value
      );
      pullSpecsPrompt.value = res.prompt || '';
    }
  } catch (err: any) {
    extractionError.value = err?.message || String(err);
  } finally {
    isPullingSpecs.value = false;
  }
}

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

async function handleApplyTrim(kind: 'prd' | 'design' | 'api', trimmedMarkdown: string) {
  try {
    extractionError.value = '';
    if (kind === 'prd' && lastPrdResult.value) {
      lastPrdResult.value.markdown = trimmedMarkdown;
      lastPrdResult.value.markdownPreview = trimmedMarkdown.slice(0, 3000);
      if (lastPrdResult.value.savedToDirectory && savedDirHandle.value) {
        await overwriteMarkdownInDirectory(
          savedDirHandle.value,
          `${lastPrdResult.value.sanitizedTitle}.md`,
          trimmedMarkdown,
          'prd',
          effectiveSpecsRootDir.value
        );
      } else {
        await navigator.clipboard.writeText(trimmedMarkdown);
      }
    } else if (kind === 'design' && lastDesignResult.value) {
      lastDesignResult.value.markdown = trimmedMarkdown;
      lastDesignResult.value.markdownPreview = trimmedMarkdown.slice(0, 3000);
      if (lastDesignResult.value.savedToDirectory && savedDirHandle.value) {
        await overwriteMarkdownInDirectory(
          savedDirHandle.value,
          `${lastDesignResult.value.sanitizedTitle}.md`,
          trimmedMarkdown,
          'design',
          effectiveSpecsRootDir.value
        );
      } else {
        await navigator.clipboard.writeText(trimmedMarkdown);
      }
    } else if (kind === 'api' && lastApiResult.value) {
      lastApiResult.value.markdown = trimmedMarkdown;
      lastApiResult.value.markdownPreview = trimmedMarkdown.slice(0, 3000);
      if (lastApiResult.value.savedToDirectory && savedDirHandle.value) {
        await overwriteMarkdownInDirectory(
          savedDirHandle.value,
          `${lastApiResult.value.sanitizedTitle}.md`,
          trimmedMarkdown,
          'api',
          effectiveSpecsRootDir.value
        );
      } else {
        await navigator.clipboard.writeText(trimmedMarkdown);
      }
    }
  } catch (err: any) {
    extractionError.value = err?.message || String(err);
  }
}

// Mode 1: PRD Extraction (with opt-in SpecLoop sync if user explicitly checked it)
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
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error(t('errNoTab'));

    const frameId = selectedFrameId.value ?? bestFrame.value?.bestFrameId ?? 0;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_PRD',
        saveMode: mode,
        engineMode: engineMode.value,
        autoTrimNoise: autoTrimNoise.value,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || t('errExtractFailed'));
    }

    const rawRes = res.bundle || res.data?.bundle || res;
    let displayRelativeDir = `${effectiveSpecsRootDir.value}/prd`;
    let relativeMdPath = `${effectiveSpecsRootDir.value}/prd/${rawRes.sanitizedTitle}.md`;
    let diffFilename: string | undefined;
    let diffSummary: SpecDiffResult | undefined;

    if (mode === 'directory' && targetDir) {
      progressMessage.value = t('writingFiles');
      const writeRes = await writePrdBundleToDirectory(
        targetDir,
        {
          title: rawRes.title,
          sanitizedTitle: rawRes.sanitizedTitle,
          markdown: rawRes.markdown,
          assets: rawRes.assets || [],
        },
        effectiveSpecsRootDir.value
      );
      displayRelativeDir = writeRes.displayRelativeDir;
      relativeMdPath = writeRes.relativeMdPath;
      diffFilename = writeRes.diffFilename;
      diffSummary = writeRes.diffSummary;
    }

    let specLoopSyncNotice = '';
    if (syncPrdToSpecLoop.value && specLoopConnected.value) {
      progressMessage.value = t('pushingToSpecLoop');
      const manifest = createSpecBundleManifest({
        type: 'prd',
        title: rawRes.title,
        sanitizedTitle: rawRes.sanitizedTitle,
        sourceUrl: pageUrl.value,
        markdownFile: `${rawRes.sanitizedTitle}.md`,
        diffFile: diffFilename,
        assetsCount: rawRes.totalAssets ?? (rawRes.assets ? rawRes.assets.length : 0),
      });
      const pushRes = await pushSpecBundleToSpecLoop({
        config: specLoopConfig.value,
        manifest,
        markdown: rawRes.markdown,
        diffMarkdown: diffSummary?.diffMarkdown,
        assets: rawRes.assets || [],
        taskId: syncTargetTaskId.value,
      });
      if (pushRes.ok) {
        specLoopSyncNotice = t('pushSpecLoopSuccess')(pushRes.taskId);
        refreshSpecLoopWorkspaceData();
      } else {
        extractionError.value = `本地已保存，但同步 SpecLoop 失败: ${pushRes.error}`;
      }
    }

    lastPrdResult.value = {
      title: rawRes.title,
      sanitizedTitle: rawRes.sanitizedTitle,
      rawMarkdown: rawRes.rawMarkdown || rawRes.markdown,
      markdown: rawRes.markdown,
      assets: rawRes.assets || [],
      totalAssets: rawRes.totalAssets ?? (rawRes.assets ? rawRes.assets.length : 0),
      trimmedHeadings: rawRes.trimmedHeadings || [],
      warnings: rawRes.warnings || [],
      markdownPreview: rawRes.markdownPreview || (rawRes.markdown ? rawRes.markdown.slice(0, 3000) : ''),
      savedToDirectory: mode === 'directory' && Boolean(targetDir),
      displayRelativeDir,
      relativeMdPath,
      diffFilename,
      diffSummary,
      specLoopSyncNotice,
    };
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      extractionError.value = err?.message || String(err);
    }
  } finally {
    isExtracting.value = false;
  }
}

// Mode 1.5: Design Artboards Extraction (Lanhu / MasterGo / Modao / Generic)
async function handleExtractDesign(mode: 'directory' | 'zip') {
  if (isExtracting.value) return;
  extractionError.value = '';

  if (designArtboards.value.length > 0 && selectedArtboardIds.value.length === 0) {
    extractionError.value = t('errNoSelection');
    return;
  }

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
  progressMessage.value = t('scanningArtboards');

  try {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error(t('errNoTab'));

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_DESIGN',
        saveMode: mode,
        selectedIds: selectedArtboardIds.value.length > 0 ? selectedArtboardIds.value : undefined,
      },
      { frameId: designFrameId.value }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || t('errExtractFailed'));
    }

    let displayRelativeDir = `${effectiveSpecsRootDir.value}/design`;
    let relativeMdPath = `${effectiveSpecsRootDir.value}/design/${res.sanitizedTitle}.md`;
    let diffFilename: string | undefined;
    let diffSummary: SpecDiffResult | undefined;

    if (mode === 'directory' && targetDir) {
      progressMessage.value = t('writingFiles');
      const writeRes = await writeDesignBundleToDirectory(
        targetDir,
        {
          title: res.title,
          sanitizedTitle: res.sanitizedTitle,
          markdown: res.markdown,
          assets: res.assets || [],
        },
        effectiveSpecsRootDir.value
      );
      displayRelativeDir = writeRes.displayRelativeDir;
      relativeMdPath = writeRes.relativeMdPath;
      diffFilename = writeRes.diffFilename;
      diffSummary = writeRes.diffSummary;
    }

    let specLoopSyncNotice = '';
    if (syncDesignToSpecLoop.value && specLoopConnected.value) {
      progressMessage.value = t('pushingToSpecLoop');
      const manifest = createSpecBundleManifest({
        type: 'design',
        title: res.title,
        sanitizedTitle: res.sanitizedTitle,
        sourceUrl: pageUrl.value,
        markdownFile: `${res.sanitizedTitle}.md`,
        diffFile: diffFilename,
        assetsCount: res.totalAssets ?? 0,
        artboardsCount: res.artboardsCount ?? 0,
        platform: res.platform,
      });
      const pushRes = await pushSpecBundleToSpecLoop({
        config: specLoopConfig.value,
        manifest,
        markdown: res.markdown,
        diffMarkdown: diffSummary?.diffMarkdown,
        assets: res.assets || [],
        taskId: syncTargetTaskId.value,
        sectionAnchor: syncDesignSectionAnchor.value || undefined,
      });
      if (pushRes.ok) {
        specLoopSyncNotice = t('pushSpecLoopSuccess')(pushRes.taskId);
        refreshSpecLoopWorkspaceData();
      } else {
        extractionError.value = `本地已保存，但同步 SpecLoop 失败: ${pushRes.error}`;
      }
    }

    lastDesignResult.value = {
      title: res.title,
      sanitizedTitle: res.sanitizedTitle,
      platform: res.platform,
      rawMarkdown: res.markdown,
      markdown: res.markdown,
      assets: res.assets || [],
      totalAssets: res.totalAssets ?? 0,
      artboardsCount: res.artboardsCount ?? 0,
      warnings: res.warnings || [],
      markdownPreview: res.markdownPreview || res.markdown.slice(0, 3000),
      savedToDirectory: mode === 'directory' && Boolean(targetDir),
      displayRelativeDir,
      relativeMdPath,
      diffFilename,
      diffSummary,
      specLoopSyncNotice,
    };
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

  if (apiEndpoints.value.length > 0 && selectedEndpointKeys.value.length === 0) {
    extractionError.value = t('errNoSelection');
    return;
  }

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
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error(t('errNoTab'));

    const frameId = selectedFrameId.value ?? bestFrame.value?.bestFrameId ?? 0;
    const isSubsetSelected =
      apiEndpoints.value.length > 0 && selectedEndpointKeys.value.length < apiEndpoints.value.length;

    const res: any = await browser.tabs.sendMessage(
      tabId,
      {
        type: 'EXTRACT_API',
        saveMode: mode,
        selectedKeys: isSubsetSelected ? selectedEndpointKeys.value : undefined,
      },
      { frameId }
    );

    if (!res || !res.ok) {
      throw new Error(res?.error || t('errExtractFailed'));
    }

    const rawRes = res.spec || res.data?.spec || res;
    let displayRelativeDir = `${effectiveSpecsRootDir.value}/api`;
    let relativeMdPath = `${effectiveSpecsRootDir.value}/api/${rawRes.sanitizedTitle}.md`;
    let diffFilename: string | undefined;
    let diffSummary: SpecDiffResult | undefined;

    if (mode === 'directory' && targetDir) {
      progressMessage.value = t('writingFiles');
      const writeRes = await writeApiSpecToDirectory(
        targetDir,
        {
          title: rawRes.title,
          sanitizedTitle: rawRes.sanitizedTitle,
          markdown: rawRes.markdown,
        },
        effectiveSpecsRootDir.value
      );
      displayRelativeDir = writeRes.displayRelativeDir;
      relativeMdPath = writeRes.relativeMdPath;
      diffFilename = writeRes.diffFilename;
      diffSummary = writeRes.diffSummary;
    }

    let specLoopSyncNotice = '';
    if (syncApiToSpecLoop.value && specLoopConnected.value) {
      progressMessage.value = t('pushingToSpecLoop');
      const manifest = createSpecBundleManifest({
        type: 'api',
        title: rawRes.title,
        sanitizedTitle: rawRes.sanitizedTitle,
        sourceUrl: pageUrl.value,
        markdownFile: `${rawRes.sanitizedTitle}.md`,
        diffFile: diffFilename,
        assetsCount: 0,
        endpointsCount: rawRes.endpointsCount,
      });
      const pushRes = await pushSpecBundleToSpecLoop({
        config: specLoopConfig.value,
        manifest,
        markdown: rawRes.markdown,
        diffMarkdown: diffSummary?.diffMarkdown,
        assets: [],
        taskId: syncTargetTaskId.value,
      });
      if (pushRes.ok) {
        specLoopSyncNotice = t('pushSpecLoopSuccess')(pushRes.taskId);
        refreshSpecLoopWorkspaceData();
      } else {
        extractionError.value = `本地已保存，但同步 SpecLoop 失败: ${pushRes.error}`;
      }
    }

    lastApiResult.value = {
      title: rawRes.title,
      sanitizedTitle: rawRes.sanitizedTitle,
      rawMarkdown: rawRes.markdown,
      markdown: rawRes.markdown,
      endpointsCount: rawRes.endpointsCount,
      format: rawRes.format,
      markdownPreview: rawRes.markdownPreview || (rawRes.markdown ? rawRes.markdown.slice(0, 3000) : ''),
      savedToDirectory: mode === 'directory' && Boolean(targetDir),
      displayRelativeDir,
      relativeMdPath,
      diffFilename,
      diffSummary,
      specLoopSyncNotice,
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
  persistActiveTab(currentTab.value);
  browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
  window.close();
}
</script>

<template>
  <div class="flex flex-col min-h-[520px] w-full max-w-lg bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 select-none">
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
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[190px]" :title="pageTitle">
            {{ activeHost }}: {{ pageTitle }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-1.5">
        <button
          type="button"
          @click="toggleLocale"
          class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition shadow-xs cursor-pointer"
          :title="t('switchLangTitle')"
        >
          <Languages class="w-3.5 h-3.5 text-indigo-500" />
          <span>{{ currentLocale === 'zh-CN' ? 'EN' : '中' }}</span>
        </button>

        <div
          v-if="bestFrame"
          class="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
          :class="bestFrame.totalFrames > 1 ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'"
          :title="t('framesTooltip')(bestFrame.totalFrames, selectedFrameId)"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>{{ bestFrame.totalFrames > 1 ? t('framesPierced')(bestFrame.totalFrames) : t('singleFrame') }}</span>
        </div>

        <button
          v-if="!props.isSidepanel"
          @click="openSidePanel"
          class="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition cursor-pointer"
          :title="t('openInSidePanel')"
        >
          <ExternalLink class="w-4 h-4" />
        </button>
      </div>
    </header>

    <!-- Global Directory Status Bar -->
    <div class="px-4 py-2 bg-indigo-50/70 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-1.5 min-w-0">
        <FolderCheck v-if="dirName" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <HardDrive v-else class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
        <span class="text-slate-600 dark:text-slate-300 truncate">
          {{ dirName ? t('boundDir')(dirName) : t('unboundDir') }}
        </span>
        <span
          v-if="dirName && effectiveSpecsRootDir !== DEFAULT_SPECS_ROOT_DIR"
          class="px-1.5 py-0.2 rounded bg-indigo-100/80 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-mono text-[10px] flex-shrink-0"
          :title="previewSpecsPath"
        >
          {{ effectiveSpecsRootDir }}/
        </span>
      </div>
      <button
        type="button"
        @click="currentTab = 'dir'"
        class="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0 ml-2 cursor-pointer"
      >
        {{ dirName ? t('manageDir') : t('setupDir') }}
      </button>
    </div>

    <!-- Navigation Tabs (QA Tab is strictly invisible unless SpecLoop is connected) -->
    <nav
      ref="tabListRef"
      role="tablist"
      :aria-label="t('tabNavLabel')"
      class="flex flex-nowrap border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-1"
      @keydown="handleTabListKeydown"
    >
      <button
        v-for="tab in visibleTabs"
        :key="tab.id"
        :id="`tab-${tab.id}`"
        type="button"
        role="tab"
        :aria-selected="currentTab === tab.id"
        :tabindex="currentTab === tab.id ? 0 : -1"
        @click="currentTab = tab.id"
        class="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 px-1 text-[11px] leading-tight font-semibold whitespace-nowrap transition-colors cursor-pointer text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 aria-selected:text-indigo-600 dark:aria-selected:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-transparent aria-selected:after:border-indigo-600 dark:aria-selected:after:border-indigo-400"
      >
        <component :is="tab.icon" class="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span class="truncate max-w-full">{{ tab.label }}</span>
      </button>
    </nav>

    <!-- Main Content Area -->
    <main class="flex-1 p-4 overflow-y-auto">
      <div v-if="extractionError" class="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-start space-x-2">
        <AlertCircle class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div class="flex-1">{{ extractionError }}</div>
      </div>

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

      <!-- ==================== TAB 1: PRD EXTRACTOR ==================== -->
      <section v-if="currentTab === 'prd'" role="tabpanel" aria-labelledby="tab-prd" class="space-y-4">
        <div v-if="bestFrame" class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-xs space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium">{{ t('targetBodyFrame') }}</span>
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
                #{{ f.frameId }} {{ f.isTopFrame ? `(${t('topWindow')})` : '' }} {{ f.platformBadge ? `[${f.platformBadge}] ` : '' }}{{ f.title ? `- ${f.title.slice(0, 18)}` : '' }} ({{ f.score }}{{ t('scoreUnit') }})
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

          <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-xs">
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

          <label class="flex items-center space-x-2 px-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              v-model="autoTrimNoise"
              class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>{{ t('autoTrimNoiseLabel') }}</span>
          </label>

          <div class="space-y-2 pt-1">
            <button
              @click="handleExtractPrd('directory')"
              :disabled="isExtracting"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99] cursor-pointer"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? t('processing') : t('btnWriteDir')(dirName) }}</span>
            </button>

            <!-- Opt-in SpecLoop Sync Checkbox (ONLY visible when connected, STRICTLY unchecked by default) -->
            <div v-if="specLoopConnected" class="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-900/60 space-y-2">
              <label class="flex items-center space-x-2 text-[11px] text-indigo-800 dark:text-indigo-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  v-model="syncPrdToSpecLoop"
                  class="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>{{ t('syncToSpecLoopCheckbox') }}</span>
              </label>
              <SpecLoopTaskPicker
                v-if="syncPrdToSpecLoop"
                v-model="syncTargetTaskId"
                :tasks="specLoopTasks"
                :loading="isLoadingSpecLoopTasks"
                :current-title="pageTitle"
                @refresh="refreshSpecLoopWorkspaceData()"
              />
            </div>

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
            <CheckCircle2 class="w-4 h-4 flex-shrink-0" />
            <span class="truncate">{{ lastPrdResult.savedToDirectory ? t('successWrite')(lastPrdResult.relativeMdPath || '') : t('successDownload') }}</span>
          </div>

          <div v-if="lastPrdResult.specLoopSyncNotice" class="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
            ✓ {{ lastPrdResult.specLoopSyncNotice }}
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
              <span class="font-mono text-indigo-600 dark:text-indigo-400 text-[11px] truncate max-w-[210px]">
                {{ lastPrdResult.displayRelativeDir || `${effectiveSpecsRootDir}/prd` }}/
              </span>
            </div>
          </div>

          <div
            v-if="lastPrdResult.trimmedHeadings.length > 0"
            class="px-2 py-1.5 rounded bg-slate-100 dark:bg-slate-900 text-[10px] text-slate-600 dark:text-slate-400"
          >
            {{ t('autoTrimmedNotice')(lastPrdResult.trimmedHeadings.join(', ')) }}
          </div>

          <DiffBadgeBox
            v-if="lastPrdResult.diffFilename && lastPrdResult.diffSummary?.hasChanges"
            :diff-filename="lastPrdResult.diffFilename"
            :main-filename="`${lastPrdResult.sanitizedTitle}.md`"
            :relative-dir="lastPrdResult.displayRelativeDir"
            :diff-summary="lastPrdResult.diffSummary"
          />

          <div v-if="lastPrdResult.warnings && lastPrdResult.warnings.length > 0" class="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 text-[11px] space-y-1">
            <div class="font-semibold flex items-center space-x-1">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ t('downgradeNotice')(lastPrdResult.warnings.length) }}</span>
            </div>
            <ul class="list-disc list-inside max-h-24 overflow-y-auto space-y-0.5">
              <li v-for="(w, idx) in lastPrdResult.warnings" :key="idx" class="truncate">{{ w }}</li>
            </ul>
          </div>

          <div class="flex space-x-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <button
              @click="copyToClipboard(t('aiPromptPrd')(lastPrdResult.relativeMdPath || `${effectiveSpecsRootDir}/prd/${lastPrdResult.sanitizedTitle}.md`, lastPrdResult.sanitizedTitle), 'prompt')"
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

          <SectionTrimmerBox
            :raw-markdown="lastPrdResult.rawMarkdown"
            :saved-to-directory="lastPrdResult.savedToDirectory"
            :auto-trim-applied="autoTrimNoise"
            @apply-trim="(md) => handleApplyTrim('prd', md)"
          />

          <SpecLoopActionBar
            v-if="prdManifest"
            :manifest="prdManifest"
            :markdown="lastPrdResult.markdown"
            :diff-markdown="lastPrdResult.diffSummary?.diffMarkdown"
            :assets="lastPrdResult.assets"
            :spec-loop-config="specLoopConfig"
            :tasks="specLoopTasks"
            :loading-tasks="isLoadingSpecLoopTasks"
            @open-settings="currentTab = 'dir'"
            @refresh-tasks="refreshSpecLoopWorkspaceData()"
          />

          <details class="text-xs pt-1">
            <summary class="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium select-none hover:underline">
              {{ t('viewMarkdownPreview') }}
            </summary>
            <pre class="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">{{ lastPrdResult.markdownPreview }}</pre>
          </details>
        </div>
      </section>

      <!-- ==================== TAB 2: DESIGN ARTBOARDS EXTRACTOR ==================== -->
      <section v-if="currentTab === 'design'" role="tabpanel" aria-labelledby="tab-design" class="space-y-4">
        <div v-if="bestFrame && bestFrame.frames && bestFrame.frames.length > 1" class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-400">{{ t('switchFrame') }}</span>
            <select
              v-model="designFrameId"
              class="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer max-w-[210px] truncate"
            >
              <option v-for="f in bestFrame.frames" :key="f.frameId" :value="f.frameId">
                #{{ f.frameId }} {{ f.isTopFrame ? `(${t('topWindow')})` : '' }} {{ f.platformBadge ? `[${f.platformBadge}] ` : '' }}{{ f.title ? `- ${f.title.slice(0, 18)}` : '' }}
              </option>
            </select>
          </div>
        </div>

        <DesignArtboardSelector
          v-model="selectedArtboardIds"
          :artboards="designArtboards"
          :platform="designPlatform"
          :color-tokens="designColorTokens"
          :annotations-count="designAnnotationsCount"
          :loading="isScanningArtboards"
          @rescan="scanDesignArtboards()"
        />

        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div>
            <h2 class="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1 flex items-center space-x-1.5">
              <Palette class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{{ t('designTitle') }}</span>
            </h2>
            <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {{ t('designDesc') }}
            </p>
          </div>

          <div class="space-y-2 pt-1">
            <button
              @click="handleExtractDesign('directory')"
              :disabled="isExtracting || designArtboards.length === 0"
              class="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow transition active:scale-[0.99] cursor-pointer"
            >
              <FolderSync class="w-4 h-4" />
              <span>{{ isExtracting ? t('processing') : t('btnWriteDesignDir')(dirName) }}</span>
            </button>

            <!-- Opt-in SpecLoop Sync Checkbox (ONLY visible when connected, STRICTLY unchecked by default) -->
            <div v-if="specLoopConnected" class="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-900/60 space-y-2">
              <label class="flex items-center space-x-2 text-[11px] text-indigo-800 dark:text-indigo-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  v-model="syncDesignToSpecLoop"
                  class="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>{{ t('syncToSpecLoopCheckbox') }}</span>
              </label>
              <SpecLoopTaskPicker
                v-if="syncDesignToSpecLoop"
                v-model="syncTargetTaskId"
                v-model:section-anchor="syncDesignSectionAnchor"
                :tasks="specLoopTasks"
                :loading="isLoadingSpecLoopTasks"
                :current-title="pageTitle"
                :show-section-anchor="true"
                @refresh="refreshSpecLoopWorkspaceData()"
              />
            </div>

            <button
              @click="handleExtractDesign('zip')"
              :disabled="isExtracting || designArtboards.length === 0"
              class="w-full py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <Download class="w-3.5 h-3.5" />
              <span>{{ t('btnDownloadDesignZip') }}</span>
            </button>
          </div>
        </div>

        <!-- Design Result Card -->
        <div v-if="lastDesignResult" class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/60 shadow-sm space-y-3">
          <div class="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
            <CheckCircle2 class="w-4 h-4 flex-shrink-0" />
            <span class="truncate">{{ lastDesignResult.savedToDirectory ? t('successDesignWrite')(lastDesignResult.relativeMdPath || '') : t('successDesignDownload') }}</span>
          </div>

          <div v-if="lastDesignResult.specLoopSyncNotice" class="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
            ✓ {{ lastDesignResult.specLoopSyncNotice }}
          </div>

          <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('exportedArtboards') }}</span>
              <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ t('assetsCount')(lastDesignResult.artboardsCount) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">{{ t('isolatedPath') }}</span>
              <span class="font-mono text-indigo-600 dark:text-indigo-400 text-[11px] truncate max-w-[210px]">
                {{ lastDesignResult.displayRelativeDir || `${effectiveSpecsRootDir}/design` }}/
              </span>
            </div>
          </div>

          <DiffBadgeBox
            v-if="lastDesignResult.diffFilename && lastDesignResult.diffSummary?.hasChanges"
            :diff-filename="lastDesignResult.diffFilename"
            :main-filename="`${lastDesignResult.sanitizedTitle}.md`"
            :relative-dir="lastDesignResult.displayRelativeDir"
            :diff-summary="lastDesignResult.diffSummary"
          />

          <div v-if="lastDesignResult.warnings.length > 0" class="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 text-[11px] space-y-1">
            <div class="font-semibold flex items-center space-x-1">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              <span>{{ t('downgradeNotice')(lastDesignResult.warnings.length) }}</span>
            </div>
            <ul class="list-disc list-inside max-h-24 overflow-y-auto space-y-0.5">
              <li v-for="(w, idx) in lastDesignResult.warnings" :key="idx" class="truncate">{{ w }}</li>
            </ul>
          </div>

          <div class="flex space-x-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <button
              @click="copyToClipboard(t('aiPromptDesign')(lastDesignResult.relativeMdPath || `${effectiveSpecsRootDir}/design/${lastDesignResult.sanitizedTitle}.md`, lastDesignResult.sanitizedTitle), 'prompt')"
              class="flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950 dark:hover:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedPrompt" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedPrompt ? t('copiedPrompt') : t('copyPrompt') }}</span>
            </button>

            <button
              @click="copyToClipboard(lastDesignResult.markdown, 'markdown')"
              class="py-1.5 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              <Check v-if="copiedMarkdown" class="w-3.5 h-3.5 text-emerald-600" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedMarkdown ? t('copiedMarkdown') : t('copyFullMarkdown') }}</span>
            </button>
          </div>

          <SectionTrimmerBox
            :raw-markdown="lastDesignResult.rawMarkdown"
            :saved-to-directory="lastDesignResult.savedToDirectory"
            @apply-trim="(md) => handleApplyTrim('design', md)"
          />

          <SpecLoopActionBar
            v-if="designManifest"
            :manifest="designManifest"
            :markdown="lastDesignResult.markdown"
            :diff-markdown="lastDesignResult.diffSummary?.diffMarkdown"
            :assets="lastDesignResult.assets"
            :spec-loop-config="specLoopConfig"
            :tasks="specLoopTasks"
            :loading-tasks="isLoadingSpecLoopTasks"
            @open-settings="currentTab = 'dir'"
            @refresh-tasks="refreshSpecLoopWorkspaceData()"
          />

          <details class="text-xs pt-1">
            <summary class="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium select-none hover:underline">
              {{ t('viewMarkdownPreview') }}
            </summary>
            <pre class="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">{{ lastDesignResult.markdownPreview }}</pre>
          </details>
        </div>
      </section>

      <!-- ==================== TAB 3: API SPEC EXTRACTOR ==================== -->
      <section v-if="currentTab === 'api'" role="tabpanel" aria-labelledby="tab-api" class="space-y-4">
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
                #{{ f.frameId }} {{ f.isTopFrame ? `(${t('topWindow')})` : '' }} {{ f.platformBadge ? `[${f.platformBadge}] ` : '' }}{{ f.title ? `- ${f.title.slice(0, 18)}` : '' }} ({{ f.score }}{{ t('scoreUnit') }})
              </option>
            </select>
          </div>
        </div>

        <ApiEndpointSelector
          v-model="selectedEndpointKeys"
          :endpoints="apiEndpoints"
          :loading="isScanningEndpoints"
          @rescan="scanApiEndpoints()"
        />

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

            <!-- Opt-in SpecLoop Sync Checkbox (ONLY visible when connected, STRICTLY unchecked by default) -->
            <div v-if="specLoopConnected" class="p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-900/60 space-y-2">
              <label class="flex items-center space-x-2 text-[11px] text-indigo-800 dark:text-indigo-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  v-model="syncApiToSpecLoop"
                  class="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>{{ t('syncToSpecLoopCheckbox') }}</span>
              </label>
              <SpecLoopTaskPicker
                v-if="syncApiToSpecLoop"
                v-model="syncTargetTaskId"
                :tasks="specLoopTasks"
                :loading="isLoadingSpecLoopTasks"
                :current-title="pageTitle"
                @refresh="refreshSpecLoopWorkspaceData()"
              />
            </div>

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
            <CheckCircle2 class="w-4 h-4 flex-shrink-0" />
            <span class="truncate">{{ lastApiResult.savedToDirectory ? t('successApiWrite')(lastApiResult.relativeMdPath || '') : t('successApiDownload') }}</span>
          </div>

          <div v-if="lastApiResult.specLoopSyncNotice" class="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
            ✓ {{ lastApiResult.specLoopSyncNotice }}
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

          <DiffBadgeBox
            v-if="lastApiResult.diffFilename && lastApiResult.diffSummary?.hasChanges"
            :diff-filename="lastApiResult.diffFilename"
            :main-filename="`${lastApiResult.sanitizedTitle}.md`"
            :relative-dir="lastApiResult.displayRelativeDir"
            :diff-summary="lastApiResult.diffSummary"
          />

          <div class="flex space-x-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <button
              @click="copyToClipboard(t('aiPromptApi')(lastApiResult.relativeMdPath || `${effectiveSpecsRootDir}/api/${lastApiResult.sanitizedTitle}.md`), 'prompt')"
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

          <SectionTrimmerBox
            :raw-markdown="lastApiResult.rawMarkdown"
            :saved-to-directory="lastApiResult.savedToDirectory"
            @apply-trim="(md) => handleApplyTrim('api', md)"
          />

          <SpecLoopActionBar
            v-if="apiManifest"
            :manifest="apiManifest"
            :markdown="lastApiResult.markdown"
            :diff-markdown="lastApiResult.diffSummary?.diffMarkdown"
            :assets="[]"
            :spec-loop-config="specLoopConfig"
            :tasks="specLoopTasks"
            :loading-tasks="isLoadingSpecLoopTasks"
            @open-settings="currentTab = 'dir'"
            @refresh-tasks="refreshSpecLoopWorkspaceData()"
          />

          <details class="text-xs pt-1">
            <summary class="cursor-pointer text-indigo-600 dark:text-indigo-400 font-medium select-none hover:underline">
              {{ t('viewMarkdownPreview') }}
            </summary>
            <pre class="mt-1 p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">{{ lastApiResult.markdownPreview }}</pre>
          </details>
        </div>
      </section>

      <!-- ==================== TAB 3.5: LIVE QA COMPANION (CONDITIONAL) ==================== -->
      <section v-if="currentTab === 'qa' && specLoopConnected" role="tabpanel" aria-labelledby="tab-qa">
        <QaCompanionPanel
          :spec-loop-config="specLoopConfig"
          :tasks="specLoopTasks"
          :loading-tasks="isLoadingSpecLoopTasks"
          :saved-dir-handle="savedDirHandle"
          :specs-root-dir="effectiveSpecsRootDir"
          @refresh-tasks="refreshSpecLoopWorkspaceData()"
          @open-settings="currentTab = 'dir'"
        />
      </section>

      <!-- ==================== TAB 4: DIRECTORY & SPECLOOP SETTINGS ==================== -->
      <section v-if="currentTab === 'dir'" role="tabpanel" aria-labelledby="tab-dir" class="space-y-4">
        <!-- Local Directory Card -->
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

          <div class="space-y-1.5 text-xs">
            <div class="flex items-center justify-between gap-2">
              <label for="specs-root-input" class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {{ t('specsRootLabel') }}
              </label>
              <div class="flex items-center space-x-1.5 min-w-0">
                <span
                  class="px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[140px]"
                  :class="
                    isProjectOverrideActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                      : 'bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400'
                  "
                  :title="dirName ? t('specsRootScopeProject')(dirName) : t('specsRootScopeGlobal')"
                >
                  {{ dirName ? t('specsRootScopeProject')(dirName) : t('specsRootScopeGlobal') }}
                </span>
                <button
                  v-if="isProjectOverrideActive"
                  type="button"
                  @click="handleResetProjectSpecsRoot"
                  class="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex-shrink-0"
                >
                  {{ t('specsRootResetDefault') }}
                </button>
              </div>
            </div>

            <p id="specs-root-hint" class="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate" :title="previewSpecsPath">
              {{ t('specsRootHint')(previewSpecsPath) }}
            </p>

            <input
              id="specs-root-input"
              v-model="specsRootInput"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :placeholder="t('specsRootPlaceholder')"
              :aria-invalid="showSpecsRootError ? 'true' : 'false'"
              :aria-describedby="showSpecsRootError ? 'specs-root-hint specs-root-error' : 'specs-root-hint'"
              @input="handleSpecsRootInput"
              @blur="commitSpecsRootInput"
              @keydown.enter.prevent="commitSpecsRootInput"
              class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 transition"
              :class="
                showSpecsRootError
                  ? 'border-red-400 dark:border-red-600 bg-red-50/40 dark:bg-red-950/20 focus:ring-red-500'
                  : 'border-slate-200 dark:border-slate-700 focus:ring-indigo-500'
              "
            />

            <div
              v-if="showSpecsRootError"
              id="specs-root-error"
              class="flex items-start space-x-1 text-[11px] text-red-600 dark:text-red-400"
            >
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{{ specsRootErrorText }}</span>
            </div>

            <div aria-live="polite" class="sr-only">{{ specsRootAnnouncement }}</div>

            <div class="flex flex-wrap items-center gap-1 pt-0.5">
              <button
                v-for="preset in SPECS_ROOT_PRESETS"
                :key="preset"
                type="button"
                @click="applySpecsRootPreset(preset)"
                class="px-2 py-0.5 rounded-md font-mono text-[10px] font-medium border transition cursor-pointer"
                :class="
                  effectiveSpecsRootDir === preset
                    ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                    : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                "
              >
                {{ preset }}
              </button>
            </div>

            <div
              v-if="specsRootConflict?.status === 'conflict'"
              class="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-amber-800 dark:text-amber-300 text-[11px] space-y-1.5"
            >
              <div class="flex items-start space-x-1.5 font-semibold">
                <AlertTriangle class="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>{{ t('specsRootConflictTitle')(specsRootConflict.resolvedRootPath) }}</span>
              </div>
              <p class="text-[10px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
                {{
                  t('specsRootConflictDesc')(
                    specsRootConflict.nonSpecEntries.join(', '),
                    Math.max(0, specsRootConflict.totalNonSpecCount - specsRootConflict.nonSpecEntries.length)
                  )
                }}
              </p>
              <div v-if="specsRootConflict.suggestedAlternatives.length > 0" class="flex flex-wrap items-center gap-1">
                <button
                  v-for="alt in specsRootConflict.suggestedAlternatives"
                  :key="alt"
                  type="button"
                  @click="applySpecsRootPreset(alt)"
                  class="px-2 py-0.5 rounded bg-white/90 hover:bg-white dark:bg-slate-900/80 dark:hover:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-mono text-[10px] font-semibold transition cursor-pointer"
                >
                  → {{ alt }}
                </button>
              </div>
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

        <!-- Optional SpecLoop Bridge Settings -->
        <div class="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <Link2 class="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 class="text-xs font-bold text-slate-900 dark:text-white">{{ t('specLoopSectionTitle') }}</h2>
            </div>
            <span
              v-if="specLoopConnected"
              class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
            >
              Online
            </span>
          </div>
          <p class="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            {{ t('specLoopSectionDesc') }}
          </p>

          <div v-if="specLoopConnError" class="p-2 rounded bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-[11px]">
            {{ specLoopConnError }}
          </div>

          <div class="space-y-2.5 text-xs">
            <div>
              <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {{ t('specLoopUrlLabel') }}
              </label>
              <input
                v-model="specLoopConfig.baseUrl"
                type="url"
                :placeholder="t('specLoopUrlPlaceholder')"
                class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <!-- Connected Account Status -->
            <div v-if="specLoopConnected" class="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
              <div class="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium truncate">
                {{ t('specLoopConnectedAs')(specLoopConfig.userEmail || 'PAT Authorized') }}
              </div>
              <button
                type="button"
                @click="handleDisconnectSpecLoop"
                class="inline-flex items-center space-x-1 text-[10px] font-semibold text-red-600 dark:text-red-400 hover:underline flex-shrink-0 ml-2 cursor-pointer"
              >
                <Unlink class="w-3 h-3" />
                <span>{{ t('specLoopDisconnectBtn') }}</span>
              </button>
            </div>

            <button
              v-else
              type="button"
              @click="handleConnectSpecLoop"
              class="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 shadow transition cursor-pointer"
            >
              <Link2 class="w-3.5 h-3.5" />
              <span>{{ t('specLoopConnectBtn') }}</span>
            </button>

            <div v-if="specLoopConnected && specLoopProjects.length > 0">
              <label class="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                {{ t('specLoopProjectLabel') }}
              </label>
              <select
                v-model="specLoopConfig.defaultProjectId"
                @change="handleSaveSpecLoopConfig()"
                class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="">{{ t('specLoopAllProjects') }}</option>
                <option v-for="proj in specLoopProjects" :key="proj.id" :value="proj.id">
                  {{ proj.name }}
                </option>
              </select>
            </div>

            <!-- Reverse Pull Finalized Specs (only when connected) -->
            <div v-if="specLoopConnected" class="pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-2">
              <div class="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center space-x-1">
                <CloudDownload class="w-3.5 h-3.5 text-indigo-500" />
                <span>{{ t('pullSpecsTitle') }}</span>
              </div>
              <select
                v-model="pullTaskId"
                class="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <option v-for="task in specLoopTasks" :key="task.id" :value="task.id">
                  {{ task.id }} · {{ task.title }}
                </option>
              </select>
              <button
                type="button"
                @click="handlePullFullSpecs"
                :disabled="!pullTaskId || isPullingSpecs"
                class="w-full py-1.5 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <CloudDownload class="w-3.5 h-3.5" />
                <span>{{ isPullingSpecs ? t('processing') : t('pullFullSpecsBtn')(effectiveSpecsRootDir) }}</span>
              </button>
              <div v-if="pullSpecsMsg" class="p-2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] space-y-1">
                <div>✓ {{ pullSpecsMsg }}</div>
                <button
                  v-if="pullSpecsPrompt"
                  type="button"
                  @click="copyToClipboard(pullSpecsPrompt, 'prompt')"
                  class="inline-flex items-center space-x-1 text-[10px] underline font-semibold cursor-pointer"
                >
                  <Copy class="w-3 h-3" />
                  <span>{{ copiedPrompt ? t('copiedPrompt') : t('copyPrompt') }}</span>
                </button>
              </div>
            </div>

            <!-- Collapsible Manual Token Fallback -->
            <details class="pt-1 text-[11px]">
              <summary class="cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 select-none">
                {{ t('specLoopManualTokenToggle') }}
              </summary>
              <div class="mt-2 space-y-2">
                <input
                  v-model="specLoopConfig.apiToken"
                  type="password"
                  :placeholder="t('specLoopTokenPlaceholder')"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                />
                <button
                  type="button"
                  @click="handleSaveSpecLoopConfig"
                  class="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 transition cursor-pointer"
                >
                  <Check v-if="specLoopSaved" class="w-3.5 h-3.5 text-emerald-300" />
                  <span>{{ specLoopSaved ? t('specLoopSavedNotice') : t('saveSpecLoopBtn') }}</span>
                </button>
              </div>
            </details>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div class="font-bold text-indigo-700 dark:text-indigo-300 flex items-center space-x-1">
            <Sparkles class="w-3.5 h-3.5" />
            <span>{{ t('workflowTitle') }}</span>
          </div>
          <p class="leading-relaxed">
            {{ t('workflowDesc')(effectiveSpecsRootDir) }}
          </p>
          <pre class="p-2 rounded bg-white dark:bg-slate-900 font-mono text-[10px] text-slate-800 dark:text-slate-200 overflow-x-auto">@{{ effectiveSpecsRootDir }}/prd/feature.md @{{ effectiveSpecsRootDir }}/design/feature.md @{{ effectiveSpecsRootDir }}/api/feature.md</pre>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
      <span>{{ t('footerTitle') }}</span>
      <a
        href="https://github.com/balmjs/page-spec"
        target="_blank"
        rel="noopener noreferrer"
        class="font-mono text-indigo-600 dark:text-indigo-400 hover:underline flex items-center space-x-1"
        title="GitHub: balmjs/page-spec"
      >
        <span>v{{ PAGESPEC_VERSION }}</span>
      </a>
    </footer>
  </div>
</template>
