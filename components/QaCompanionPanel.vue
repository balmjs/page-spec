<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Camera,
  AlertTriangle,
  Bug,
  Download,
  Copy,
  Check,
  Sparkles,
} from 'lucide-vue-next';
import {
  fetchTaskTestItems,
  updateTaskTestItemStatus,
  type SpecLoopConfig,
  type SpecLoopTaskSummary,
  type SpecLoopTestItem,
  type QaDiagnosticSnapshot,
} from '../utils/specloop-bridge';
import { pullTaskQaFailuresToLocal } from '../utils/specloop-puller';
import { verifyDirectoryPermission } from '../utils/filesystem-writer';
import { t } from '../utils/i18n';

const props = defineProps<{
  specLoopConfig: SpecLoopConfig;
  tasks: SpecLoopTaskSummary[];
  loadingTasks?: boolean;
  savedDirHandle: FileSystemDirectoryHandle | null;
  specsRootDir: string;
}>();

const emit = defineEmits<{
  (e: 'refresh-tasks'): void;
  (e: 'open-settings'): void;
}>();

const QA_TASK_STORAGE_KEY = 'pagespec_qa_selected_task_id';

function readCachedTaskIdSync(): string {
  try {
    return localStorage.getItem(QA_TASK_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeCachedTaskIdSync(taskId: string) {
  try {
    if (taskId) {
      localStorage.setItem(QA_TASK_STORAGE_KEY, taskId);
    } else {
      localStorage.removeItem(QA_TASK_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function persistSelectedTaskId(taskId: string) {
  preferredTaskId.value = taskId;
  writeCachedTaskIdSync(taskId);
  if (taskId) {
    browser.storage.local.set({ [QA_TASK_STORAGE_KEY]: taskId }).catch(() => {});
  } else {
    browser.storage.local.remove(QA_TASK_STORAGE_KEY).catch(() => {});
  }
}

const preferredTaskId = ref(readCachedTaskIdSync());
const selectedTaskId = ref('');
const items = ref<SpecLoopTestItem[]>([]);
const isLoadingItems = ref(false);
const errorMsg = ref('');
const statusMsg = ref('');
const unlockedBanner = ref(false);

// Active failure capture state
const capturingItemId = ref<string | null>(null);
const capturedPreviewUrl = ref('');
const capturedBase64 = ref('');
const capturedDiag = ref<QaDiagnosticSnapshot | null>(null);
const failNote = ref('');
const isSubmittingFail = ref(false);
const updatingItemId = ref<string | null>(null);

// Reverse pull QA bugs state
const isPullingBugs = ref(false);
const pulledBugPrompt = ref('');
const copiedBugPrompt = ref(false);

const passedCount = computed(() => items.value.filter((i) => i.status === 'passed').length);
const failedCount = computed(() => items.value.filter((i) => i.status === 'failed').length);
const staleCount = computed(() => items.value.filter((i) => i.status === 'stale').length);
const passRate = computed(() =>
  items.value.length ? Math.round((passedCount.value / items.value.length) * 100) : 0
);

function reconcileSelectedTask(list: SpecLoopTaskSummary[], preferStored = false) {
  if (list.length === 0) {
    selectedTaskId.value = '';
    return;
  }
  if (
    preferStored &&
    preferredTaskId.value &&
    list.some((task) => task.id === preferredTaskId.value)
  ) {
    selectedTaskId.value = preferredTaskId.value;
    return;
  }
  if (selectedTaskId.value && list.some((task) => task.id === selectedTaskId.value)) {
    return;
  }
  if (preferredTaskId.value && list.some((task) => task.id === preferredTaskId.value)) {
    selectedTaskId.value = preferredTaskId.value;
    return;
  }
  const qaTask = list.find((task) => task.currentStage === 'qa_testing') || list[0];
  selectedTaskId.value = qaTask ? qaTask.id : '';
}

function handleTaskSelectChange() {
  if (selectedTaskId.value) {
    persistSelectedTaskId(selectedTaskId.value);
  }
}

function handleStorageChanged(
  changes: Record<string, { newValue?: unknown }>,
  areaName: string
) {
  if (areaName !== 'local') return;
  const change = changes[QA_TASK_STORAGE_KEY];
  if (!change) return;
  const nextId = typeof change.newValue === 'string' ? change.newValue : '';
  if (nextId && nextId !== preferredTaskId.value) {
    preferredTaskId.value = nextId;
    writeCachedTaskIdSync(nextId);
    reconcileSelectedTask(props.tasks, true);
  }
}

onMounted(async () => {
  try {
    const stored = await browser.storage.local.get(QA_TASK_STORAGE_KEY);
    const storedId =
      typeof stored?.[QA_TASK_STORAGE_KEY] === 'string' ? stored[QA_TASK_STORAGE_KEY] : '';
    if (storedId) {
      preferredTaskId.value = storedId;
      writeCachedTaskIdSync(storedId);
    }
  } catch {
    // ignore storage read errors
  }

  reconcileSelectedTask(props.tasks, true);
  browser.storage?.onChanged?.addListener(handleStorageChanged);
});

onUnmounted(() => {
  try {
    browser.storage?.onChanged?.removeListener(handleStorageChanged);
  } catch {
    // ignore unregister errors
  }
});

watch(
  () => props.tasks,
  (list) => {
    reconcileSelectedTask(list);
  },
  { immediate: true }
);

watch(selectedTaskId, (id) => {
  if (id) {
    loadItems();
  } else {
    items.value = [];
  }
});

async function loadItems() {
  if (!selectedTaskId.value) return;
  isLoadingItems.value = true;
  errorMsg.value = '';
  unlockedBanner.value = false;
  try {
    const res = await fetchTaskTestItems(props.specLoopConfig, selectedTaskId.value);
    if (res.ok) {
      items.value = res.items;
    } else {
      errorMsg.value = res.error || t('errQaLoadItems');
    }
  } catch (err: any) {
    errorMsg.value = err?.message || String(err);
  } finally {
    isLoadingItems.value = false;
  }
}

async function handlePassItem(item: SpecLoopTestItem) {
  if (updatingItemId.value) return;
  updatingItemId.value = item.id;
  errorMsg.value = '';
  try {
    const nextStatus = item.status === 'passed' ? 'pending' : 'passed';
    const res = await updateTaskTestItemStatus({
      config: props.specLoopConfig,
      taskId: selectedTaskId.value,
      itemId: item.id,
      status: nextStatus,
    });
    if (res.ok) {
      item.status = nextStatus;
      if (res.unlockedRelease) {
        unlockedBanner.value = true;
      }
      emit('refresh-tasks');
    } else {
      errorMsg.value = res.error || t('errQaUpdateStatus');
    }
  } catch (err: any) {
    errorMsg.value = err?.message || String(err);
  } finally {
    updatingItemId.value = null;
  }
}

async function startCaptureFailure(item: SpecLoopTestItem) {
  errorMsg.value = '';
  capturingItemId.value = item.id;
  capturedPreviewUrl.value = '';
  capturedBase64.value = '';
  capturedDiag.value = null;
  failNote.value = item.testerNote || '';

  try {
    // 1. Capture active tab screenshot via Background Service Worker
    const capRes: any = await browser.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (capRes?.ok) {
      capturedPreviewUrl.value = capRes.dataUrl || '';
      capturedBase64.value = capRes.base64 || '';
    }

    // 2. Collect URL, viewport, and recent console/HTTP errors from active tab via on-demand MAIN world read
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      try {
        const diagRes: any = await browser.runtime.sendMessage({
          type: 'READ_QA_DIAGNOSTICS',
          tabId: tabs[0].id,
        });
        if (diagRes?.ok && diagRes.data) {
          capturedDiag.value = diagRes.data;
        } else {
          capturedDiag.value = {
            url: tabs[0].url || '',
            title: tabs[0].title || '',
            viewport: '',
            userAgent: '',
            errors: [],
          };
        }
      } catch {
        capturedDiag.value = {
          url: tabs[0].url || '',
          title: tabs[0].title || '',
          viewport: '',
          userAgent: '',
          errors: [],
        };
      }
    }
  } catch (err: any) {
    errorMsg.value = err?.message || String(err);
  }
}

function cancelCapture() {
  capturingItemId.value = null;
  capturedPreviewUrl.value = '';
  capturedBase64.value = '';
  capturedDiag.value = null;
  failNote.value = '';
}

async function submitCaptureFailure(item: SpecLoopTestItem) {
  if (isSubmittingFail.value) return;
  isSubmittingFail.value = true;
  errorMsg.value = '';
  try {
    const res = await updateTaskTestItemStatus({
      config: props.specLoopConfig,
      taskId: selectedTaskId.value,
      itemId: item.id,
      status: 'failed',
      testerNote: failNote.value.trim() || t('qaDefaultFailNote'),
      screenshotBase64: capturedBase64.value || undefined,
      pageUrl: capturedDiag.value?.url || undefined,
      consoleErrors: capturedDiag.value?.errors || [],
    });
    if (res.ok) {
      item.status = 'failed';
      item.testerNote = failNote.value.trim();
      item.pageUrl = capturedDiag.value?.url;
      cancelCapture();
      statusMsg.value = t('qaFailSubmitted');
      setTimeout(() => (statusMsg.value = ''), 3000);
      emit('refresh-tasks');
    } else {
      errorMsg.value = res.error || t('errQaSubmitFail');
    }
  } catch (err: any) {
    errorMsg.value = err?.message || String(err);
  } finally {
    isSubmittingFail.value = false;
  }
}

async function handlePullBugsToLocal() {
  if (!props.savedDirHandle) {
    emit('open-settings');
    return;
  }
  if (!selectedTaskId.value || isPullingBugs.value) return;

  errorMsg.value = '';
  // Verify readwrite permission synchronously within the click gesture BEFORE awaiting network requests
  const hasPermission = await verifyDirectoryPermission(props.savedDirHandle);
  if (!hasPermission) {
    errorMsg.value = t('errPermDenied');
    return;
  }

  isPullingBugs.value = true;
  try {
    const res = await pullTaskQaFailuresToLocal({
      dirHandle: props.savedDirHandle,
      config: props.specLoopConfig,
      taskId: selectedTaskId.value,
      specsRootDir: props.specsRootDir,
    });
    if (!res.ok) {
      errorMsg.value = res.error || t('errQaPullBugs');
    } else if (res.failedCount === 0) {
      statusMsg.value = t('qaNoFailedItems');
    } else {
      pulledBugPrompt.value = res.prompt || '';
      statusMsg.value = t('pullQaBugsSuccess')(res.failedCount, res.relativeMdPath || `${props.specsRootDir}/qa/`);
    }
  } catch (err: any) {
    errorMsg.value = err?.message || String(err);
  } finally {
    isPullingBugs.value = false;
  }
}

async function copyBugPrompt() {
  if (!pulledBugPrompt.value) return;
  await navigator.clipboard.writeText(pulledBugPrompt.value);
  copiedBugPrompt.value = true;
  setTimeout(() => (copiedBugPrompt.value = false), 2000);
}
</script>

<template>
  <div class="space-y-3">
    <!-- Task Picker + Progress Header -->
    <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2.5">
      <div class="flex items-center justify-between">
        <h2 class="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
          <Bug class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>{{ t('qaCompanionTitle') }}</span>
        </h2>
        <button
          type="button"
          @click="
            emit('refresh-tasks');
            loadItems();
          "
          :disabled="isLoadingItems || loadingTasks"
          class="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isLoadingItems || loadingTasks }" />
        </button>
      </div>

      <select
        v-model="selectedTaskId"
        @change="handleTaskSelectChange"
        class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
      >
        <option v-if="tasks.length === 0" value="">{{ t('qaNoTasks') }}</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">
          {{ task.id }} · {{ task.title }}
        </option>
      </select>

      <div v-if="items.length > 0" class="space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-medium text-slate-600 dark:text-slate-300">
            {{ passedCount }} / {{ items.length }} Passed ({{ passRate }}%)
          </span>
          <div class="flex items-center space-x-2">
            <span v-if="failedCount > 0" class="text-red-600 dark:text-red-400 font-semibold">
              {{ failedCount }} Fail
            </span>
            <span v-if="staleCount > 0" class="text-amber-600 dark:text-amber-400 font-semibold">
              {{ staleCount }} Stale
            </span>
          </div>
        </div>
        <div class="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="passRate === 100 ? 'bg-emerald-500' : 'bg-indigo-500'"
            :style="{ width: `${passRate}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Banners -->
    <div
      v-if="unlockedBanner"
      class="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center space-x-1.5"
    >
      <Sparkles class="w-4 h-4 flex-shrink-0" />
      <span>{{ t('qaUnlockedReleaseNotice') }}</span>
    </div>

    <div
      v-if="errorMsg"
      class="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs"
    >
      {{ errorMsg }}
    </div>

    <div
      v-if="statusMsg"
      class="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs space-y-1.5"
    >
      <div>{{ statusMsg }}</div>
      <button
        v-if="pulledBugPrompt"
        type="button"
        @click="copyBugPrompt"
        class="inline-flex items-center space-x-1 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-medium cursor-pointer"
      >
        <Check v-if="copiedBugPrompt" class="w-3 h-3" />
        <Copy v-else class="w-3 h-3" />
        <span>{{ copiedBugPrompt ? t('copiedPrompt') : t('copyFixPrompt') }}</span>
      </button>
    </div>

    <!-- Reverse Pull QA Failures Bar -->
    <button
      v-if="failedCount > 0"
      type="button"
      @click="handlePullBugsToLocal"
      :disabled="isPullingBugs"
      class="w-full py-2 px-3 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-medium text-xs flex items-center justify-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
    >
      <Download class="w-3.5 h-3.5" />
      <span>{{ isPullingBugs ? t('processing') : t('pullQaBugsBtn')(failedCount, specsRootDir) }}</span>
    </button>

    <!-- Checklist Items -->
    <div
      v-if="tasks.length === 0 && !loadingTasks && !isLoadingItems"
      class="p-4 text-center text-xs text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 leading-relaxed"
    >
      {{ t('qaNoTasksHint') }}
    </div>

    <div
      v-else-if="selectedTaskId && items.length === 0 && !isLoadingItems"
      class="p-4 text-center text-xs text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
    >
      {{ t('qaNoItems') }}
    </div>

    <div v-else-if="items.length > 0" class="space-y-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="p-2.5 rounded-xl bg-white dark:bg-slate-800 border shadow-xs space-y-2 transition"
        :class="
          item.status === 'passed'
            ? 'border-emerald-200 dark:border-emerald-800/70'
            : item.status === 'failed'
              ? 'border-red-200 dark:border-red-800/80'
              : item.status === 'stale'
                ? 'border-amber-300 dark:border-amber-700'
                : 'border-slate-200 dark:border-slate-700'
        "
      >
        <div class="flex items-start justify-between space-x-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-1.5 mb-0.5">
              <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {{ item.priority }}
              </span>
              <span class="text-[10px] text-slate-400 truncate">{{ item.category }}</span>
              <span
                v-if="item.status === 'stale'"
                class="inline-flex items-center space-x-0.5 px-1 py-0.2 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300"
              >
                <AlertTriangle class="w-2.5 h-2.5" />
                <span>Stale</span>
              </span>
            </div>
            <p class="text-xs font-medium text-slate-800 dark:text-slate-100 leading-snug">
              {{ item.title }}
            </p>
            <p v-if="item.expectedResult" class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {{ item.expectedResult }}
            </p>
          </div>

          <div class="flex items-center space-x-1 flex-shrink-0">
            <button
              type="button"
              @click="handlePassItem(item)"
              :disabled="updatingItemId === item.id"
              class="p-1.5 rounded-lg transition cursor-pointer"
              :class="
                item.status === 'passed'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 hover:bg-emerald-100 dark:bg-slate-700 dark:hover:bg-emerald-900/60 text-slate-500 hover:text-emerald-600'
              "
              title="Pass"
            >
              <CheckCircle2 class="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              @click="startCaptureFailure(item)"
              class="p-1.5 rounded-lg transition cursor-pointer"
              :class="
                item.status === 'failed'
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-100 hover:bg-red-100 dark:bg-slate-700 dark:hover:bg-red-900/60 text-slate-500 hover:text-red-600'
              "
              :title="t('qaCaptureFailBtn')"
            >
              <Camera class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Inline Live Capture Bug Drawer -->
        <div
          v-if="capturingItemId === item.id"
          class="p-2.5 rounded-lg bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900 space-y-2"
        >
          <img
            v-if="capturedPreviewUrl"
            :src="capturedPreviewUrl"
            alt="Captured Viewport"
            class="w-full max-h-28 object-cover rounded border border-red-200 dark:border-red-800"
          />

          <div v-if="capturedDiag" class="text-[10px] text-slate-600 dark:text-slate-300 space-y-0.5">
            <div class="truncate font-mono">{{ capturedDiag.url }}</div>
            <div class="text-red-600 dark:text-red-400 font-medium">
              {{ t('qaDiagCaptured')(capturedDiag.errors.length, capturedDiag.viewport || 'N/A') }}
            </div>
          </div>

          <textarea
            v-model="failNote"
            rows="2"
            :placeholder="t('qaNotePlaceholder')"
            class="w-full px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none"
          ></textarea>

          <div class="flex space-x-2">
            <button
              type="button"
              @click="submitCaptureFailure(item)"
              :disabled="isSubmittingFail"
              class="flex-1 py-1.5 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium flex items-center justify-center space-x-1 cursor-pointer disabled:opacity-50"
            >
              <XCircle class="w-3.5 h-3.5" />
              <span>{{ isSubmittingFail ? t('pushingToSpecLoop') : t('qaSubmitFailBtn') }}</span>
            </button>
            <button
              type="button"
              @click="cancelCapture"
              class="py-1.5 px-2.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] cursor-pointer"
            >
              {{ t('cancelBtn') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
