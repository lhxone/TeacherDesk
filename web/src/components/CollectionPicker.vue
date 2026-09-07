<script setup lang="ts">
/**
 * Custom folder picker replacing a native <select> — the native control
 * renders leading full-width spaces (indentation) inconsistently and, on
 * mobile, opens the OS's own full-screen list which drops all styling
 * (emoji, indent, hierarchy) entirely. This renders its own popover
 * (desktop: anchored below the trigger; narrow viewport: a bottom sheet)
 * with the folder tree indented and clickable, matching the sidebar tree's
 * look everywhere.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ResourceCollection } from '@/api/types';

const props = defineProps<{
  collections: ResourceCollection[];
  modelValue: string | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const byParentId = computed(() => {
  const map = new Map<string | null, ResourceCollection[]>();
  for (const c of props.collections) {
    const key = c.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return map;
});

/** Depth-first, indented flattening of the whole folder tree. */
const rows = computed(() => {
  const flatten = (parentId: string | null, depth: number): { node: ResourceCollection; depth: number }[] =>
    (byParentId.value.get(parentId) ?? []).flatMap((n) => [{ node: n, depth }, ...flatten(n.id, depth + 1)]);
  return flatten(null, 0);
});

const selectedLabel = computed(() => {
  if (!props.modelValue) return '不放入文件夹';
  return props.collections.find((c) => c.id === props.modelValue)?.name ?? '不放入文件夹';
});

function select(id: string | null) {
  emit('update:modelValue', id);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('mousedown', onClickOutside);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="picker">
    <button type="button" class="select trigger" @click="open = !open">
      <span class="trigger-label">📁 {{ selectedLabel }}</span>
      <span class="chevron" :class="{ up: open }">▾</span>
    </button>

    <!-- Backdrop: transparent on desktop (click-outside only), dimmed on the
         mobile bottom-sheet layout so the sheet reads as a modal layer. -->
    <div v-if="open" class="picker-backdrop" @click="open = false"></div>

    <div v-if="open" class="picker-panel">
      <div class="picker-option" :class="{ active: !modelValue }" @click="select(null)">
        不放入文件夹
      </div>
      <div class="picker-list">
        <div
          v-for="r in rows"
          :key="r.node.id"
          class="picker-option"
          :class="{ active: modelValue === r.node.id }"
          :style="{ paddingLeft: `${14 + r.depth * 18}px` }"
          @click="select(r.node.id)"
        >
          📁 {{ r.node.name }}
        </div>
        <div v-if="!rows.length" class="picker-empty">还没有文件夹</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker { position: relative; }

.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  cursor: pointer;
}
.trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { color: var(--text-faint); transition: transform 0.15s ease; flex-shrink: 0; margin-left: 8px; }
.chevron.up { transform: rotate(180deg); }

.picker-backdrop { position: fixed; inset: 0; z-index: 200; background: transparent; }

.picker-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 201;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  max-height: 280px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-list { overflow-y: auto; }

.picker-option {
  padding: 9px 14px;
  font-size: 13.5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--border);
}
.picker-option:last-child { border-bottom: none; }
.picker-option:hover { background: var(--hover-tint); }
.picker-option.active { background: var(--brand-soft); color: var(--brand-dark); font-weight: 600; }

.picker-empty { padding: 14px; text-align: center; color: var(--text-muted); font-size: 13px; }

/* Mobile: a bottom sheet instead of an anchored popover — easier to tap,
   and doesn't get clipped by a modal's own overflow:auto body. */
@media (max-width: 768px) {
  .picker-backdrop { background: rgb(15 23 42 / 0.45); }

  .picker-panel {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--radius) var(--radius) 0 0;
    max-height: 60vh;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .picker-option { padding: 13px 16px; font-size: 15px; }
}
</style>
