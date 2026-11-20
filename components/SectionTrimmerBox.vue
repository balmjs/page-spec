<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Scissors, Check } from 'lucide-vue-next';
import {
  parseMarkdownSections,
  trimMarkdownBySections,
  type MarkdownSectionItem,
} from '../utils/markdown-trimmer';
import { t } from '../utils/i18n';

const props = defineProps<{
  rawMarkdown: string;
  savedToDirectory?: boolean;
  autoTrimApplied?: boolean;
}>();

const emit = defineEmits<{
  (e: 'apply-trim', trimmedMarkdown: string): void;
}>();

const sections = ref<MarkdownSectionItem[]>([]);
const appliedNotice = ref(false);

function initSections(md: string) {
  const parsed = parseMarkdownSections(md);
  sections.value = parsed.map((s) => ({
    ...s,
    checked: props.autoTrimApplied ? !s.isNoisy : true,
  }));
}

watch(
  () => props.rawMarkdown,
  (md) => {
    initSections(md);
  },
  { immediate: true }
);

const keptCount = computed(() => sections.value.filter((s) => s.checked).length);

function toggleAll(checked: boolean) {
  sections.value.forEach((s) => {
    s.checked = checked;
  });
}

function handleApply() {
  const excludedIds = new Set(sections.value.filter((s) => !s.checked).map((s) => s.id));
  const trimmed = trimMarkdownBySections(props.rawMarkdown, excludedIds);
  emit('apply-trim', trimmed);
  appliedNotice.value = true;
  setTimeout(() => (appliedNotice.value = false), 2200);
}
</script>

<template>
  <details
    v-if="sections.length > 0"
    class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 text-xs"
  >
    <summary
      class="px-2.5 py-2 cursor-pointer font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between select-none hover:text-indigo-600 dark:hover:text-indigo-400"
    >
      <span class="flex items-center space-x-1.5">
        <Scissors class="w-3.5 h-3.5 text-indigo-500" />
        <span>{{ t('sectionTrimmerTitle')(keptCount, sections.length) }}</span>
      </span>
    </summary>

    <div class="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-slate-200/70 dark:border-slate-700/70">
      <div class="flex items-center justify-end space-x-2 text-[10px]">
        <button
          type="button"
          @click="toggleAll(true)"
          class="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {{ t('selectAll') }}
        </button>
        <span class="text-slate-300 dark:text-slate-600">|</span>
        <button
          type="button"
          @click="toggleAll(false)"
          class="text-slate-500 hover:underline cursor-pointer"
        >
          {{ t('clearSelection') }}
        </button>
      </div>

      <div class="max-h-36 overflow-y-auto space-y-1 pr-1">
        <label
          v-for="sec in sections"
          :key="sec.id"
          class="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-white dark:hover:bg-slate-800 cursor-pointer text-[11px]"
          :class="sec.level === 3 ? 'pl-4' : ''"
        >
          <span class="flex items-center space-x-1.5 min-w-0">
            <input
              type="checkbox"
              v-model="sec.checked"
              class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span class="truncate text-slate-700 dark:text-slate-200" :title="sec.heading">
              {{ sec.heading }}
            </span>
            <span
              v-if="sec.isNoisy"
              class="px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-[9px] font-semibold flex-shrink-0"
            >
              {{ t('noisyBadge') }}
            </span>
          </span>
          <span class="text-[10px] font-mono text-slate-400 flex-shrink-0">{{ sec.charCount }}c</span>
        </label>
      </div>

      <button
        type="button"
        @click="handleApply"
        class="w-full py-1.5 px-2.5 rounded-md bg-slate-800 hover:bg-slate-900 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-medium text-[11px] flex items-center justify-center space-x-1.5 transition cursor-pointer"
      >
        <Check v-if="appliedNotice" class="w-3.5 h-3.5 text-emerald-400" />
        <Scissors v-else class="w-3.5 h-3.5" />
        <span>
          {{
            appliedNotice
              ? t('trimAppliedSuccess')
              : savedToDirectory
                ? t('applyTrimOverwrite')
                : t('applyTrimCopyOnly')
          }}
        </span>
      </button>
    </div>
  </details>
</template>
