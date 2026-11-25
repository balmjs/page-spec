<script setup lang="ts">
import { computed } from 'vue';
import { RefreshCw, Sparkles } from 'lucide-vue-next';
import type { SpecLoopTaskSummary } from '../utils/specloop-bridge';
import { t } from '../utils/i18n';

const props = defineProps<{
  modelValue: string;
  tasks: SpecLoopTaskSummary[];
  loading?: boolean;
  currentTitle?: string;
  showSectionAnchor?: boolean;
  sectionAnchor?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
  (e: 'update:sectionAnchor', val: string): void;
  (e: 'refresh'): void;
}>();

const selectedTask = computed(() => props.tasks.find((task) => task.id === props.modelValue));
const availableSections = computed(() => selectedTask.value?.prdSections || []);

const stageBadgeMap: Record<string, string> = {
  pm_draft: 'PM',
  design_review: 'UI',
  dev_coding: 'DEV',
  qa_testing: 'QA',
  ready_to_release: 'REL',
  released: 'DONE',
};
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center space-x-1.5">
      <select
        :value="modelValue"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
        class="flex-1 min-w-0 px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800/80 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
      >
        <option value="">
          ✨ {{ t('createNewSpecLoopTask')(currentTitle ? currentTitle.slice(0, 22) : '') }}
        </option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">
          [{{ stageBadgeMap[task.currentStage] || task.currentStage }}] {{ task.id }} · {{ task.title }}
        </option>
      </select>

      <button
        type="button"
        @click="emit('refresh')"
        :disabled="loading"
        class="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition cursor-pointer disabled:opacity-50"
        :title="t('refreshSpecLoopTasks')"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <div
      v-if="showSectionAnchor && modelValue && availableSections.length > 0"
      class="flex items-center space-x-1.5 text-[10px]"
    >
      <Sparkles class="w-3 h-3 text-indigo-500 flex-shrink-0" />
      <select
        :value="sectionAnchor || ''"
        @change="emit('update:sectionAnchor', ($event.target as HTMLSelectElement).value)"
        class="flex-1 min-w-0 px-2 py-1 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
      >
        <option value="">{{ t('sectionAnchorAuto') }}</option>
        <option v-for="sec in availableSections" :key="sec" :value="sec">
          § {{ sec }}
        </option>
      </select>
    </div>
  </div>
</template>
