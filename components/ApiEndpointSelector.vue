<script setup lang="ts">
import { ref, computed } from 'vue';
import { Search, RefreshCw } from 'lucide-vue-next';
import type { ApiEndpointSummary } from '../core/extractors/api-extractor';
import { t } from '../utils/i18n';

const props = defineProps<{
  endpoints: ApiEndpointSummary[];
  modelValue: string[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
  (e: 'rescan'): void;
}>();

const searchQuery = ref('');
const selectedTag = ref('__ALL__');

const tags = computed(() => {
  const set = new Set<string>();
  for (const ep of props.endpoints) {
    if (ep.tag) set.add(ep.tag);
  }
  return Array.from(set);
});

const filteredEndpoints = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return props.endpoints.filter((ep) => {
    if (selectedTag.value !== '__ALL__' && ep.tag !== selectedTag.value) return false;
    if (!q) return true;
    return (
      ep.path.toLowerCase().includes(q) ||
      ep.summary.toLowerCase().includes(q) ||
      ep.method.toLowerCase().includes(q) ||
      ep.tag.toLowerCase().includes(q)
    );
  });
});

const selectedSet = computed(() => new Set(props.modelValue));

function toggleEndpoint(key: string) {
  const next = new Set(props.modelValue);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  emit('update:modelValue', Array.from(next));
}

function selectAllFiltered() {
  const next = new Set(props.modelValue);
  filteredEndpoints.value.forEach((ep) => next.add(ep.key));
  emit('update:modelValue', Array.from(next));
}

function clearFiltered() {
  const toRemove = new Set(filteredEndpoints.value.map((ep) => ep.key));
  emit(
    'update:modelValue',
    props.modelValue.filter((k) => !toRemove.has(k))
  );
}

function methodBadgeClass(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300';
    case 'POST':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';
    case 'PUT':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
    case 'DELETE':
      return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
    default:
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300';
  }
}
</script>

<template>
  <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2.5 text-xs">
    <div class="flex items-center justify-between">
      <span class="font-semibold text-slate-700 dark:text-slate-200">
        {{
          loading
            ? t('scanningEndpoints')
            : endpoints.length > 0
              ? t('endpointsSelectedCount')(modelValue.length, endpoints.length)
              : t('noOpenApiListFallback')
        }}
      </span>
      <button
        type="button"
        @click="emit('rescan')"
        :disabled="loading"
        class="inline-flex items-center space-x-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 cursor-pointer flex-shrink-0 ml-2"
      >
        <RefreshCw class="w-3 h-3" :class="loading ? 'animate-spin' : ''" />
        <span>{{ t('rescanEndpoints') }}</span>
      </button>
    </div>

    <template v-if="endpoints.length > 0">
      <div class="flex items-center space-x-1.5">
        <div class="relative flex-1">
          <Search class="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('searchEndpointsPlaceholder')"
            class="w-full pl-7 pr-2 py-1 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <select
          v-if="tags.length > 1"
          v-model="selectedTag"
          class="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 text-[11px] text-slate-700 dark:text-slate-200 max-w-[110px] truncate cursor-pointer"
        >
          <option value="__ALL__">{{ t('allTags') }}</option>
          <option v-for="tag in tags" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </div>

      <div class="flex items-center justify-between text-[10px] text-slate-400">
        <span>{{ filteredEndpoints.length }} / {{ endpoints.length }}</span>
        <div class="space-x-2">
          <button
            type="button"
            @click="selectAllFiltered"
            class="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {{ t('selectAll') }}
          </button>
          <span>|</span>
          <button
            type="button"
            @click="clearFiltered"
            class="text-slate-500 hover:underline cursor-pointer"
          >
            {{ t('clearSelection') }}
          </button>
        </div>
      </div>

      <div class="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-100 dark:border-slate-700/60 rounded-lg">
        <label
          v-for="ep in filteredEndpoints"
          :key="ep.key"
          class="flex items-start space-x-2 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="selectedSet.has(ep.key)"
            @change="toggleEndpoint(ep.key)"
            class="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center space-x-1.5">
              <span
                class="px-1 py-0.2 rounded text-[9px] font-bold font-mono flex-shrink-0"
                :class="methodBadgeClass(ep.method)"
              >
                {{ ep.method }}
              </span>
              <span class="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate" :title="ep.path">
                {{ ep.path }}
              </span>
            </div>
            <div v-if="ep.summary" class="text-[10px] text-slate-400 truncate mt-0.5" :title="ep.summary">
              {{ ep.summary }}
            </div>
          </div>
        </label>
      </div>
    </template>
  </div>
</template>
