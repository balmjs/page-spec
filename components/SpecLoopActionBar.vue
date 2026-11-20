<script setup lang="ts">
import { ref } from 'vue';
import { Package, Send, CheckCircle2, AlertCircle } from 'lucide-vue-next';
import type { SpecBundleManifest } from '../core/bundler/zip-builder';
import type { SerializableAsset } from '../utils/filesystem-writer';
import {
  downloadSpecBundleZip,
  pushSpecBundleToSpecLoop,
  type SpecLoopConfig,
} from '../utils/specloop-bridge';
import { t } from '../utils/i18n';

const props = defineProps<{
  manifest: SpecBundleManifest;
  markdown: string;
  diffMarkdown?: string;
  assets: SerializableAsset[];
  specLoopConfig: SpecLoopConfig;
}>();

const emit = defineEmits<{
  (e: 'open-settings'): void;
}>();

const isPushing = ref(false);
const pushSuccessMsg = ref('');
const pushErrorMsg = ref('');

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
  if (!props.specLoopConfig.baseUrl.trim()) {
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
    });

    if (res.ok) {
      pushSuccessMsg.value = t('pushSpecLoopSuccess')(res.taskId);
      setTimeout(() => (pushSuccessMsg.value = ''), 4000);
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
  <div class="space-y-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-700/60">
    <div class="flex space-x-2">
      <button
        type="button"
        @click="handleExportBundle"
        class="flex-1 py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-[11px] flex items-center justify-center space-x-1 transition cursor-pointer"
      >
        <Package class="w-3.5 h-3.5 text-indigo-500" />
        <span>{{ t('exportSpecBundle') }}</span>
      </button>

      <button
        type="button"
        @click="handlePushToSpecLoop"
        :disabled="isPushing"
        class="flex-1 py-1.5 px-2 rounded-lg font-medium text-[11px] flex items-center justify-center space-x-1 transition cursor-pointer disabled:opacity-50"
        :class="
          specLoopConfig.baseUrl
            ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600'
        "
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
