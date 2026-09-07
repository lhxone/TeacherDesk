<script setup lang="ts">
/**
 * Explorer-style expand/collapse folder tree for the sidebar. Mirrors Windows
 * Explorer's left pane: an arrow toggles a node's children without changing
 * selection, clicking the label navigates into that folder, and the active
 * folder plus every ancestor on its path stay expanded so the current
 * location is always visible in the tree.
 */
import { computed, ref, watch } from 'vue';
import { ApiError } from '@/api/client';
import { resourceCollectionsApi } from '@/api/resources';
import type { ResourceCollection } from '@/api/types';
import ResourceCollectionTreeNode from '@/components/ResourceCollectionTreeNode.vue';

const props = defineProps<{
  collections: ResourceCollection[];
  activeId: string | null;
}>();
const emit = defineEmits<{ changed: []; select: [collectionId: string | null] }>();

const byParent = computed(() => {
  const map = new Map<string | null, ResourceCollection[]>();
  for (const c of props.collections) {
    const key = c.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return map;
});

const byId = computed(() => new Map(props.collections.map((c) => [c.id, c])));
const rootNodes = computed(() => byParent.value.get(null) ?? []);

const expanded = ref<Set<string>>(new Set());

/** Keep every ancestor of the active folder expanded, so navigating deep (e.g. via breadcrumb) reveals it in the tree. */
watch(
  () => props.activeId,
  (id) => {
    let cur = id ? byId.value.get(id) ?? null : null;
    while (cur) {
      expanded.value.add(cur.id);
      cur = cur.parentId ? byId.value.get(cur.parentId) ?? null : null;
    }
  },
  { immediate: true },
);

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

const creatingParentId = ref<string | null | undefined>(undefined);
const newName = ref('');
const error = ref('');
const saving = ref(false);

const renamingId = ref<string | null>(null);
const renameValue = ref('');

function startCreate(parentId: string | null) {
  creatingParentId.value = parentId;
  newName.value = '';
  error.value = '';
  if (parentId) expanded.value.add(parentId);
}

async function submitCreate() {
  if (!newName.value.trim() || creatingParentId.value === undefined) return;
  error.value = '';
  saving.value = true;
  try {
    await resourceCollectionsApi.create({ name: newName.value.trim(), parentId: creatingParentId.value });
    creatingParentId.value = undefined;
    emit('changed');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败';
  } finally {
    saving.value = false;
  }
}

function startRename(node: ResourceCollection) {
  renamingId.value = node.id;
  renameValue.value = node.name;
}

async function submitRename(node: ResourceCollection) {
  const name = renameValue.value.trim();
  renamingId.value = null;
  if (!name || name === node.name) return;
  await resourceCollectionsApi.update(node.id, { name });
  emit('changed');
}

async function removeNode(node: ResourceCollection) {
  if (!confirm(`确定删除文件夹「${node.name}」吗？子文件夹会一并删除，里面的资源会移到未分类。`)) return;
  await resourceCollectionsApi.remove(node.id);
  if (props.activeId === node.id) emit('select', node.parentId);
  emit('changed');
}
</script>

<template>
  <div class="tree">
    <div class="tree-row root-row">
      <span class="disclosure-spacer"></span>
      <button class="tree-label" :class="{ active: activeId === null }" @click="emit('select', null)">
        📁 全部文件夹
      </button>
      <button class="icon-btn" title="新建文件夹" @click.stop="startCreate(null)">+</button>
    </div>

    <form v-if="creatingParentId === null" class="stack create-form" style="padding-left: 26px" @submit.prevent="submitCreate">
      <input v-model="newName" class="input input-sm" placeholder="文件夹名称" autofocus />
      <div class="row">
        <button class="btn btn-sm btn-primary" type="submit" :disabled="saving">创建</button>
        <button class="btn btn-sm" type="button" @click="creatingParentId = undefined">取消</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
    </form>

    <ResourceCollectionTreeNode
      v-for="node in rootNodes"
      :key="node.id"
      :node="node"
      :depth="1"
      :by-parent="byParent"
      :active-id="activeId"
      :expanded="expanded"
      :renaming-id="renamingId"
      :rename-value="renameValue"
      :creating-parent-id="creatingParentId"
      :new-name="newName"
      :saving="saving"
      :error="error"
      @toggle="toggle"
      @select="(id) => emit('select', id)"
      @start-create="startCreate"
      @submit-create="submitCreate"
      @cancel-create="creatingParentId = undefined"
      @update:new-name="(v) => (newName = v)"
      @start-rename="startRename"
      @submit-rename="submitRename"
      @update:rename-value="(v) => (renameValue = v)"
      @cancel-rename="renamingId = null"
      @remove="removeNode"
    />
  </div>
</template>

<style scoped>
.tree { display: flex; flex-direction: column; gap: 1px; }

.tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-sm);
}
.tree-row:hover { background: var(--hover-tint); }
.root-row { padding-right: 2px; }

.disclosure-spacer { width: 18px; flex-shrink: 0; display: inline-block; }

.tree-label {
  flex: 1;
  text-align: left;
  padding: 4px 4px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-label:hover { color: var(--text); }
.tree-label.active { color: var(--brand-dark); font-weight: 600; background: var(--brand-soft); border-radius: var(--radius-sm); }

.icon-btn {
  border: none;
  background: none;
  color: var(--text-faint);
  padding: 2px 4px;
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
}
.icon-btn:hover { color: var(--text); }

.input-sm { padding: 4px 8px; font-size: 13px; }
.create-form { padding: 4px 0; }
</style>
