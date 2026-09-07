<script setup lang="ts">
import { ref } from 'vue';
import { ApiError } from '@/api/client';
import { tagsApi } from '@/api/resources';
import type { Tag } from '@/api/types';

const props = defineProps<{ tags: Tag[] }>();
const emit = defineEmits<{ changed: []; select: [tagId: string] }>();

// A small curated palette rather than a raw <input type="color"> — matches
// the pill/badge look tags render as everywhere else, and keeps colors
// visually distinct instead of a teacher picking two near-identical shades.
const PALETTE = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];

const newName = ref('');
const newColor = ref(PALETTE[0]);
const error = ref('');
const saving = ref(false);

async function addTag() {
  if (!newName.value.trim()) return;
  error.value = '';
  saving.value = true;
  try {
    await tagsApi.create({ name: newName.value.trim(), color: newColor.value });
    newName.value = '';
    newColor.value = PALETTE[0];
    emit('changed');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败';
  } finally {
    saving.value = false;
  }
}

const renamingId = ref<string | null>(null);
const renameValue = ref('');

function startRename(tag: Tag) {
  renamingId.value = tag.id;
  renameValue.value = tag.name;
}

async function submitRename(tag: Tag) {
  const name = renameValue.value.trim();
  renamingId.value = null;
  if (!name || name === tag.name) return;
  await tagsApi.update(tag.id, { name });
  emit('changed');
}

async function recolor(tag: Tag, color: string) {
  if (color === tag.color) return;
  await tagsApi.update(tag.id, { color });
  emit('changed');
}

async function removeTag(tag: Tag) {
  if (!confirm(`确定删除标签「${tag.name}」吗？已打上这个标签的资源/学生会被移除该标签。`)) return;
  await tagsApi.remove(tag.id);
  emit('changed');
}
</script>

<template>
  <div class="stack">
    <form class="stack tag-form" @submit.prevent="addTag">
      <div class="row">
        <input v-model="newName" class="input" style="width: 200px" placeholder="新标签名称" />
        <button class="btn btn-primary" type="submit" :disabled="saving">添加</button>
      </div>
      <div class="row swatches">
        <button
          v-for="c in PALETTE"
          :key="c"
          type="button"
          class="swatch"
          :class="{ picked: newColor === c }"
          :style="{ background: c }"
          :aria-label="c"
          @click="newColor = c"
        ></button>
      </div>
    </form>
    <p v-if="error" class="error-text">{{ error }}</p>

    <div v-if="!props.tags.length" class="empty-inline">还没有标签，先添加一个吧</div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th>标签</th><th>颜色</th><th>关联资源</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="t in props.tags" :key="t.id">
            <td>
              <input
                v-if="renamingId === t.id"
                v-model="renameValue"
                class="input input-sm"
                autofocus
                @keyup.enter="submitRename(t)"
                @keyup.esc="renamingId = null"
                @blur="submitRename(t)"
              />
              <button v-else class="link-cell" @click="emit('select', t.id)">
                <span class="badge" :style="{ background: t.color + '22', color: t.color }">{{ t.name }}</span>
              </button>
            </td>
            <td>
              <div class="row swatches">
                <button
                  v-for="c in PALETTE"
                  :key="c"
                  type="button"
                  class="swatch swatch-sm"
                  :class="{ picked: t.color === c }"
                  :style="{ background: c }"
                  :aria-label="c"
                  @click="recolor(t, c)"
                ></button>
              </div>
            </td>
            <td>{{ t.resourceCount ?? 0 }}</td>
            <td class="row-actions-cell">
              <button class="btn btn-sm" @click="startRename(t)">重命名</button>
              <button class="btn btn-sm btn-danger" @click="removeTag(t)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.tag-form { padding-bottom: 4px; }
.swatches { flex-wrap: wrap; gap: 6px; }
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
}
.swatch.picked { border-color: var(--text); box-shadow: 0 0 0 1px var(--surface); }
.swatch-sm { width: 18px; height: 18px; }
.link-cell { border: none; background: none; padding: 0; text-align: left; }
.input-sm { padding: 4px 8px; font-size: 13px; }
.row-actions-cell { display: flex; gap: 6px; }
</style>
