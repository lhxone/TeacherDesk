<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useClassStore } from '@/stores/classes';
import { ApiError } from '@/api/client';
import ModalDialog from '@/components/ModalDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { ClassItem } from '@/api/types';

const store = useClassStore();

const filter = ref<'active' | 'archived' | 'all'>('active');
const showForm = ref(false);
const editing = ref<ClassItem | null>(null);
const error = ref('');
const saving = ref(false);

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

const form = ref({
  name: '',
  subject: '',
  academicYear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
  color: COLORS[0],
  note: '',
});

function openCreate() {
  editing.value = null;
  form.value = {
    name: '',
    subject: '',
    academicYear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
    color: COLORS[0],
    note: '',
  };
  error.value = '';
  showForm.value = true;
}

function openEdit(c: ClassItem) {
  editing.value = c;
  form.value = {
    name: c.name,
    subject: c.subject ?? '',
    academicYear: c.academicYear,
    color: c.color,
    note: c.note ?? '',
  };
  error.value = '';
  showForm.value = true;
}

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      subject: form.value.subject.trim() || null,
      academicYear: form.value.academicYear.trim(),
      color: form.value.color,
      note: form.value.note.trim() || null,
    };
    if (editing.value) await store.update(editing.value.id, payload);
    else await store.create(payload);
    showForm.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function archive(c: ClassItem) {
  await store.update(c.id, { status: c.status === 'active' ? 'archived' : 'active' });
  await store.fetchAll(filter.value);
}

async function remove(c: ClassItem) {
  if (!confirm(`确定删除「${c.name}」吗？该班级的学生、成绩与座位表将一并隐藏。`)) return;
  await store.remove(c.id);
}

onMounted(() => store.fetchAll(filter.value));
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>班级管理</h1>
      <div class="row">
        <select v-model="filter" class="select" style="width: auto" @change="store.fetchAll(filter)">
          <option value="active">在读班级</option>
          <option value="archived">已归档</option>
          <option value="all">全部</option>
        </select>
        <button class="btn btn-primary" @click="openCreate">+ 新建班级</button>
      </div>
    </header>

    <div v-if="store.loading" class="empty">加载中…</div>

    <EmptyState v-else-if="!store.items.length" icon="classes" title="还没有班级">
      点击右上角「新建班级」开始
    </EmptyState>

    <div v-else class="grid">
      <article v-for="c in store.items" :key="c.id" class="card class-card">
        <span class="class-color" :style="{ background: c.color }" />

        <RouterLink :to="{ name: 'class-detail', params: { classId: c.id } }" class="class-link">
          <div class="class-head">
            <h3>{{ c.name }}</h3>
            <span v-if="c.status === 'archived'" class="badge archived">已归档</span>
          </div>
          <p class="hint">
            {{ c.subject ?? '未设学科' }} · {{ c.academicYear }} · {{ c.studentCount }} 人
          </p>
          <p v-if="c.latestExam?.avg != null" class="hint">
            最近考试「{{ c.latestExam.name }}」均分 <strong>{{ c.latestExam.avg }}</strong>
          </p>
        </RouterLink>

        <div class="class-actions">
          <button class="btn btn-sm" @click="openEdit(c)">编辑</button>
          <button class="btn btn-sm" @click="archive(c)">
            {{ c.status === 'active' ? '归档' : '恢复' }}
          </button>
          <button class="btn btn-sm btn-danger" @click="remove(c)">删除</button>
        </div>
      </article>
    </div>

    <ModalDialog
      v-if="showForm"
      :title="editing ? '编辑班级' : '新建班级'"
      @close="showForm = false"
    >
      <form class="stack" @submit.prevent="save">
        <div class="field">
          <label>班级名称</label>
          <input v-model="form.name" class="input" required placeholder="如：高二(3)班" />
        </div>
        <div class="field">
          <label>学科（任课教师可填）</label>
          <input v-model="form.subject" class="input" placeholder="如：数学" />
        </div>
        <div class="field">
          <label>学年</label>
          <input v-model="form.academicYear" class="input" required placeholder="2026-2027" />
        </div>
        <div class="field">
          <label>颜色标记</label>
          <div class="row">
            <button
              v-for="c in COLORS"
              :key="c"
              type="button"
              class="swatch"
              :class="{ picked: form.color === c }"
              :style="{ background: c }"
              @click="form.color = c"
            />
          </div>
        </div>
        <div class="field">
          <label>备注</label>
          <textarea v-model="form.note" class="textarea" />
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>

      <template #footer>
        <button class="btn" @click="showForm = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.class-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
.class-color { position: absolute; inset: 0 auto 0 0; width: 4px; }
.class-link { color: inherit; display: block; }
.class-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.badge.archived { background: var(--hover-tint); color: var(--text-muted); }
.class-actions { display: flex; gap: 6px; border-top: 1px solid var(--border); padding-top: 10px; }

.swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
}
.swatch.picked { border-color: var(--text); }
</style>
