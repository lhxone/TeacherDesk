<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiError } from '@/api/client';
import { knowledgeNodesApi } from '@/api/resources';
import type { KnowledgeNode } from '@/api/types';

const props = defineProps<{ nodes: KnowledgeNode[] }>();
const emit = defineEmits<{ changed: []; select: [nodeId: string] }>();

const newName = ref('');
const newParentId = ref<string>('');
const error = ref('');
const saving = ref(false);

/** Build a parentId -> children[] lookup and render as an indented flat list (simplest reliable tree UI). */
const byParent = computed(() => {
  const map = new Map<string | null, KnowledgeNode[]>();
  for (const n of props.nodes) {
    const key = n.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return map;
});

function flatten(parentId: string | null, depth: number): { node: KnowledgeNode; depth: number }[] {
  const children = byParent.value.get(parentId) ?? [];
  return children.flatMap((n) => [{ node: n, depth }, ...flatten(n.id, depth + 1)]);
}

const rows = computed(() => flatten(null, 0));

async function addNode() {
  if (!newName.value.trim()) return;
  error.value = '';
  saving.value = true;
  try {
    await knowledgeNodesApi.create({ name: newName.value.trim(), parentId: newParentId.value || null });
    newName.value = '';
    newParentId.value = '';
    emit('changed');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败';
  } finally {
    saving.value = false;
  }
}

async function removeNode(node: KnowledgeNode) {
  if (!confirm(`确定删除知识点「${node.name}」吗？子知识点会一并删除。`)) return;
  await knowledgeNodesApi.remove(node.id);
  emit('changed');
}
</script>

<template>
  <div class="stack">
    <form class="row" @submit.prevent="addNode">
      <input v-model="newName" class="input" style="width: 200px" placeholder="新知识点名称" />
      <select v-model="newParentId" class="select" style="width: 200px">
        <option value="">作为根节点</option>
        <option v-for="r in rows" :key="r.node.id" :value="r.node.id">
          {{ '　'.repeat(r.depth) }}{{ r.node.name }}
        </option>
      </select>
      <button class="btn btn-primary" type="submit" :disabled="saving">添加</button>
    </form>
    <p v-if="error" class="error-text">{{ error }}</p>

    <div v-if="!rows.length" class="empty-inline">还没有知识点，先添加一个吧</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th>知识点</th><th>科目</th><th>年级</th><th>关联资源</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.node.id">
            <td>
              <button class="link-cell" @click="emit('select', r.node.id)">
                {{ '　'.repeat(r.depth) }}{{ r.node.name }}
              </button>
            </td>
            <td>{{ r.node.subject ?? '—' }}</td>
            <td>{{ r.node.grade ?? '—' }}</td>
            <td>{{ r.node.resourceCount }}</td>
            <td><button class="btn btn-sm btn-danger" @click="removeNode(r.node)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.link-cell { border: none; background: none; color: var(--brand); padding: 0; text-align: left; }
.link-cell:hover { text-decoration: underline; }
</style>
