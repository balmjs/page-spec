<script setup lang="ts">
import { ref, computed } from 'vue';
import { Search, RefreshCw, Image as ImageIcon } from 'lucide-vue-next';
import type { DesignArtboardSummary, DesignPlatform } from '../core/extractors/design-extractor';
import { t } from '../utils/i18n';

const props = defineProps<{
  artboards: DesignArtboardSummary[];
  modelValue: string[];
  platform?: DesignPlatform;
  vectorCount?: number;
  colorTokens?: string[];
  annotationsCount?: number;
  loading?: boolean;
}>();

const PLATFORM_DISPLAY_NAMES: Record<DesignPlatform, string> = {
  figma: 'Figma',
  zeplin: 'Zeplin',
  sketch: 'Sketch',
  lanhu: 'Lanhu',
  mockplus: 'Mockplus',
  mastergo: 'MasterGo',
  pixso: 'Pixso',
  modao: 'Modao',
  axure: 'Axure',
  'generic-design': 'Web',
};

const platformLabel = computed(() =>
  props.platform && props.platform !== 'generic-design'
    ? PLATFORM_DISPLAY_NAMES[props.platform] || props.platform
    : ''
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
  (e: 'rescan'): void;
}>();

const searchQuery = ref('');

const filteredArtboards = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.artboards;
  return props.artboards.filter((a) => a.name.toLowerCase().includes(q));
});

const selectedSet = computed(() => new Set(props.modelValue));

function toggleArtboard(id: string) {
  const next = new Set(props.modelValue);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  emit('update:modelValue', Array.from(next));
}

function selectAllFiltered() {
  const next = new Set(props.modelValue);
  filteredArtboards.value.forEach((a) => next.add(a.id));
  emit('update:modelValue', Array.from(next));
}

function clearFiltered() {
  const toRemove = new Set(filteredArtboards.value.map((a) => a.id));
  emit(
    'update:modelValue',
    props.modelValue.filter((id) => !toRemove.has(id))
  );
}
</script>

<template>
  <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2.5 text-xs">
    <div class="flex items-center justify-between">
      <span class="font-semibold text-slate-700 dark:text-slate-200">
        {{
          loading
            ? t('scanningArtboards')
            : artboards.length > 0
              ? t('artboardsSelectedCount')(modelValue.length, artboards.length)
              : t('noArtboardsFound')
        }}
      </span>
      <button
        type="button"
        @click="emit('rescan')"
        :disabled="loading"
        class="inline-flex items-center space-x-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 cursor-pointer flex-shrink-0 ml-2"
      >
        <RefreshCw class="w-3 h-3" :class="loading ? 'animate-spin' : ''" />
        <span>{{ t('rescanArtboards') }}</span>
      </button>
    </div>

    <!-- Platform / Vectors / Color Tokens / Annotations metadata badges -->
    <div
      v-if="platformLabel || (vectorCount && vectorCount > 0) || (colorTokens && colorTokens.length > 0) || (annotationsCount && annotationsCount > 0)"
      class="flex flex-wrap items-center gap-1.5 text-[10px]"
    >
      <span
        v-if="platformLabel"
        class="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold"
      >
        {{ t('detectedPlatformShort') }} {{ platformLabel }}
      </span>
      <span
        v-if="vectorCount && vectorCount > 0"
        class="px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300"
      >
        {{ t('detectedVectors') }} {{ vectorCount }}
      </span>
      <span
        v-if="colorTokens && colorTokens.length > 0"
        class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
      >
        {{ t('detectedTokens') }} {{ colorTokens.length }}
      </span>
      <span
        v-if="annotationsCount && annotationsCount > 0"
        class="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300"
      >
        {{ t('detectedAnnotations') }} {{ annotationsCount }}
      </span>
    </div>

    <template v-if="artboards.length > 0">
      <div class="relative">
        <Search class="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('searchArtboardsPlaceholder')"
          class="w-full pl-7 pr-2 py-1 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div class="flex items-center justify-between text-[10px] text-slate-400">
        <span>{{ filteredArtboards.length }} / {{ artboards.length }}</span>
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

      <div class="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-100 dark:border-slate-700/60 rounded-lg">
        <label
          v-for="item in filteredArtboards"
          :key="item.id"
          class="flex items-center space-x-2 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="selectedSet.has(item.id)"
            @change="toggleArtboard(item.id)"
            class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer flex-shrink-0"
          />
          <div class="w-9 h-7 rounded bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img
              v-if="item.previewUrl"
              :src="item.previewUrl"
              :alt="item.name"
              class="w-full h-full object-cover"
            />
            <ImageIcon v-else class="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-slate-800 dark:text-slate-200 truncate" :title="item.name">
              {{ item.name }}
            </div>
            <div class="text-[10px] font-mono text-slate-400">
              {{ item.width }}×{{ item.height }} · {{ item.sourceType.toUpperCase() }}
            </div>
          </div>
        </label>
      </div>
    </template>
  </div>
</template>
