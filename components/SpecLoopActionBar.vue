<script setup lang="ts">
import { ref, computed } from 'vue';
import { Package, Send, CheckCircle2, AlertCircle } from 'lucide-vue-next';
import type { SpecBundleManifest } from '../core/bundler/zip-builder';
import type { SerializableAsset } from '../utils/filesystem-writer';
import {
  downloadSpecBundleZip,
  pushSpecBundleToSpecLoop,
  isSpecLoopConnected,
  type SpecLoopConfig,
  type SpecLoopTaskSummary,
} from '../utils/specloop-bridge';
import { t } from '../utils/i18n';
import SpecLoopTaskPicker from './SpecLoopTaskPicker.vue';

const props = defineProps<{
  manifest: SpecBundleManifest;
  markdown: string;
  diffMarkdown?: string;
  assets: SerializableAsset[];
  specLoopConfig: SpecLoopConfig;
  tasks?: SpecLoopTaskSummary[];
  loadingTasks?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-settings'): void;
  (e: 'refresh-tasks'): void;
}>();

const selectedTaskId = ref(props.specLoopConfig.defaultTaskId || '');
const sectionAnchor = ref('');
const isPushing = ref(false);
const pushSuccessMsg = ref('');
const pushErrorMsg = ref('');

const connected = computed(() => isSpecLoopConnected(props.specLoopConfig));

async function handleExportBundle() {
  pushErrorMsg.value = '';
  try {
    await downloadSpecBundleZip({
      manifest: props.manifest,
      markdown: props.markdown,
      diffMarkdown: props.diffMarkdown,
      assets: props.assets,
    });
  } catch (err: any) {
    pushErrorMsg.value = err?.message || String(err);
  }
}

async function handlePushToSpecLoop() {
  if (!connected.value) {
    emit('open-settings');
    return;
  }
  if (isPushing.value) return;

  isPushing.value = true;
  pushSuccessMsg.value = '';
  pushErrorMsg.value = '';

  try {
    const res = await pushSpecBundleToSpecLoop({
      config: props.specLoopConfig,
      manifest: props.manifest,
      markdown: props.markdown,
      diffMarkdown: props.diffMarkdown,
      assets: props.assets,
      taskId: selectedTaskId.value,
      sectionAnchor: sectionAnchor.value || undefined,
    });

    if (res.ok) {
      const staleNote =
        res.staleTestCount && res.staleTestCount > 0
          ? ` (${t('staleTestsMarked')(res.staleTestCount)})`
          : '';
      pushSuccessMsg.value = `${t('pushSpecLoopSuccess')(res.taskId)}${staleNote}`;
      emit('refresh-tasks');
      setTimeout(() => (pushSuccessMsg.value = ''), 5000);
    } else {
      pushErrorMsg.value = res.error || 'Push failed';
    }
  } catch (err: any) {
    pushErrorMsg.value = err?.message || String(err);
  } finally {
    isPushing.value = false;
  }
}
</script>

<template>
  <div class="space-y-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/60">
    <!-- Dynamic task selector shown ONLY when user has connected SpecLoop -->
    <SpecLoopTaskPicker
      v-if="connected"
      v-model="selectedTaskId"
      v-model:section-anchor="sectionAnchor"
      :tasks="tasks || []"
      :loading="loadingTasks"
      :current-title="manifest.title"
      :show-section-anchor="manifest.type === 'design'"
      @refresh="emit('refresh-tasks')"
    />

    <div class="flex space-x-2">
      <button
        type="button"
        @click="handleExportBundle"
        class="flex-1 py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-[11px] flex items-center justify-center space-x-1 transition cursor-pointer"
      >
        <Package class="w-3.5 h-3.5 text-indigo-500" />
        <span>{{ t('exportSpecBundle') }}</span>
      </button>

      <!-- Manual push button shown ONLY when SpecLoop is connected (pure standalone UX otherwise) -->
      <button
        v-if="connected"
        type="button"
        @click="handlePushToSpecLoop"
        :disabled="isPushing"
        class="flex-1 py-1.5 px-2 rounded-lg font-medium text-[11px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
      >
        <Send class="w-3.5 h-3.5" />
        <span>{{ isPushing ? t('pushingToSpecLoop') : t('pushToSpecLoop') }}</span>
      </button>
    </div>

    <div
      v-if="pushSuccessMsg"
      class="flex items-center space-x-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium"
    >
      <CheckCircle2 class="w-3 h-3 flex-shrink-0" />
      <span>{{ pushSuccessMsg }}</span>
    </div>

    <div
      v-if="pushErrorMsg"
      class="flex items-center space-x-1 text-[10px] text-red-600 dark:text-red-400"
    >
      <AlertCircle class="w-3 h-3 flex-shrink-0" />
      <span class="truncate" :title="pushErrorMsg">{{ pushErrorMsg }}</span>
    </div>
  </div>
</template>
