<script setup lang="ts">
/**
 * One recursive level of the Explorer-style folder tree. A .vue SFC can
 * reference itself in its own template via its filename as the tag
 * (<ResourceCollectionTreeNode>) — Vue resolves the implicit self-import for
 * <script setup> components, no manual `name`/registration needed.
 */
import { computed } from 'vue';
import { ApiError } from '@/api/client';
import { resourceCollectionsApi } from '@/api/resources';
import type { ResourceCollection } from '@/api/types';

const props = defineProps<{
  node: ResourceCollection;
  depth: number;
  byParent: Map<string | null, ResourceCollection[]>;
  activeId: string | null;
  expanded: Set<string>;
  renamingId: string | null;
  renameValue: string;
  creatingParentId: string | null | undefined;
  newName: string;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  select: [id: string | null];
  startCreate: [parentId: string | null];
  submitCreate: [];
  cancelCreate: [];
  'update:newName': [value: string];
  startRename: [node: ResourceCollection];
  submitRename: [node: ResourceCollection];
  'update:renameValue': [value: string];
  cancelRename: [];
  remove: [node: ResourceCollection];
}>();

const children = computed(() => props.byParent.get(props.node.id) ?? []);
const hasChildren = computed(() => children.value.length > 0);
const isExpanded = computed(() => props.expanded.has(props.node.id));
const indentPx = computed(() => (props.depth - 1) * 14);

async function submitRenameLocal() {
  emit('submitRename', props.node);
}
</script>

<template>
  <div>
    <div v-if="renamingId === node.id" class="tree-row" :style="{ paddingLeft: `${indentPx}px` }">
      <span class="disclosure-spacer"></span>
      <input
        class="input input-sm"
        :value="renameValue"
        autofocus
        @input="emit('update:renameValue', ($event.target as HTMLInputElement).value)"
        @keyup.enter="submitRenameLocal"
        @keyup.esc="emit('cancelRename')"
        @blur="submitRenameLocal"
      />
    </div>
    <div v-else class="tree-row" :style="{ paddingLeft: `${indentPx}px` }">
      <button
        class="disclosure"
        :class="{ invisible: !hasChildren }"
        @click.stop="emit('toggle', node.id)"
      >{{ hasChildren ? (isExpanded ? '▾' : '▸') : '' }}</button>
      <button class="tree-label" :class="{ active: activeId === node.id }" @click="emit('select', node.id)">
        📁 {{ node.name }}
      </button>
      <span class="count hint">({{ node.resourceCount }})</span>
      <span class="row-actions">
        <button class="icon-btn" title="新建子文件夹" @click.stop="emit('startCreate', node.id)">+</button>
        <button class="icon-btn" title="重命名" @click.stop="emit('startRename', node)">✎</button>
        <button class="icon-btn" title="删除" @click.stop="emit('remove', node)">✕</button>
      </span>
    </div>

    <form
      v-if="creatingParentId === node.id"
      class="stack create-form"
      :style="{ paddingLeft: `${depth * 14 + 26}px` }"
      @submit.prevent="emit('submitCreate')"
    >
      <input
        class="input input-sm"
        placeholder="文件夹名称"
        :value="newName"
        autofocus
        @input="emit('update:newName', ($event.target as HTMLInputElement).value)"
      />
      <div class="row">
        <button class="btn btn-sm btn-primary" type="submit" :disabled="saving">创建</button>
        <button class="btn btn-sm" type="button" @click="emit('cancelCreate')">取消</button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
    </form>

    <template v-if="hasChildren && isExpanded">
      <ResourceCollectionTreeNode
        v-for="child in children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :by-parent="byParent"
        :active-id="activeId"
        :expanded="expanded"
        :renaming-id="renamingId"
        :rename-value="renameValue"
        :creating-parent-id="creatingParentId"
        :new-name="newName"
        :saving="saving"
        :error="error"
        @toggle="(id) => emit('toggle', id)"
        @select="(id) => emit('select', id)"
        @start-create="(id) => emit('startCreate', id)"
        @submit-create="emit('submitCreate')"
        @cancel-create="emit('cancelCreate')"
        @update:new-name="(v) => emit('update:newName', v)"
        @start-rename="(n) => emit('startRename', n)"
        @submit-rename="(n) => emit('submitRename', n)"
        @update:rename-value="(v) => emit('update:renameValue', v)"
        @cancel-rename="emit('cancelRename')"
        @remove="(n) => emit('remove', n)"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-sm);
}
.tree-row:hover { background: var(--hover-tint); }

.disclosure {
  width: 18px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--text-faint);
  font-size: 10px;
  padding: 0;
}
.disclosure.invisible { visibility: hidden; }
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

.count { flex-shrink: 0; font-size: 12px; margin-right: 2px; }

.row-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; }
.tree-row:hover .row-actions { opacity: 1; }
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
