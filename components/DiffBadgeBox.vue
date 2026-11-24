<script setup lang="ts">
import { ref } from 'vue';
import { GitCompareArrows, Copy, Check } from 'lucide-vue-next';
import type { SpecDiffResult } from '../utils/spec-diff';
import { t } from '../utils/i18n';

const props = defineProps<{
  diffFilename: string;
  mainFilename: string;
  relativeDir?: string;
  diffSummary: SpecDiffResult;
}>();

const copiedDiff = ref(false);

async function copyDiffPrompt() {
  try {
    const prefix = props.relativeDir || 'specs/prd';
    await navigator.clipboard.writeText(
      t('aiPromptDiff')(`${prefix}/${props.diffFilename}`, `${prefix}/${props.mainFilename}`)
    );
    copiedDiff.value = true;
    setTimeout(() => (copiedDiff.value = false), 2000);
  } catch (err) {
    console.error('[PageSpec] Failed to copy diff prompt:', err);
  }
}
</script>

<template>
  <div
    class="p-2.5 rounded-lg bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/70 text-[11px] space-y-2"
  >
    <div class="flex items-center justify-between">
      <span class="font-bold text-violet-700 dark:text-violet-300 flex items-center space-x-1">
        <GitCompareArrows class="w-3.5 h-3.5 flex-shrink-0" />
        <span>{{ t('diffDetectedTitle') }}</span>
      </span>
      <span class="font-mono text-[10px] text-violet-600 dark:text-violet-400 truncate max-w-[140px]" :title="diffFilename">
        {{ diffFilename }}
      </span>
    </div>

    <div class="text-violet-700/90 dark:text-violet-300/90 text-[10px] leading-snug">
      {{
        t('diffStats')(
          diffSummary.addedSections,
          diffSummary.modifiedSections,
          diffSummary.removedSections,
          diffSummary.addedLines,
          diffSummary.removedLines
        )
      }}
    </div>

    <button
      type="button"
      @click="copyDiffPrompt"
      class="w-full py-1.5 px-2.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
    >
      <Check v-if="copiedDiff" class="w-3.5 h-3.5 text-emerald-300" />
      <Copy v-else class="w-3.5 h-3.5" />
      <span>{{ copiedDiff ? t('copiedDiffPrompt') : t('copyDiffPrompt') }}</span>
    </button>
  </div>
</template>
