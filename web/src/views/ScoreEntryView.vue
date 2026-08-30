<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { Envelope, ExamStats, ScoreRow } from '@/api/types';

const props = defineProps<{ examId: string }>();

type Sheet = {
  exam: { id: string; name: string; subject: string | null; fullScore: number; examDate: string };
  scores: ScoreRow[];
};

const sheet = ref<Sheet | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);
const pasteText = ref('');
const showPaste = ref(false);

const entered = computed(
  () => sheet.value?.scores.filter((s) => s.score !== null || s.isAbsent).length ?? 0,
);

const liveStats = computed<ExamStats | null>(() => {
  if (!sheet.value) return null;
  const vals = sheet.value.scores
    .filter((s) => !s.isAbsent && s.score !== null)
    .map((s) => s.score as number);
  if (!vals.length) return null;

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const full = sheet.value.exam.fullScore;
  return {
    total: sheet.value.scores.length,
    attended: vals.length,
    absent: sheet.value.scores.filter((s) => s.isAbsent).length,
    avg: Math.round(avg * 100) / 100,
    max: Math.max(...vals),
    min: Math.min(...vals),
    median: null,
    stddev: null,
    passRate: vals.filter((v) => v >= full * 0.6).length / vals.length,
    excellentRate: vals.filter((v) => v >= full * 0.85).length / vals.length,
  };
});

async function load() {
  loading.value = true;
  try {
    const res = await api.get<Envelope<Sheet>>(`/exams/${props.examId}/scores`);
    sheet.value = res.data;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

/** Enter / ArrowDown jump to the next input so a whole class can be typed without the mouse. */
function focusNext(index: number) {
  const inputs = document.querySelectorAll<HTMLInputElement>('.score-input');
  inputs[index + 1]?.focus();
  inputs[index + 1]?.select();
}

function toggleAbsent(row: ScoreRow) {
  row.isAbsent = !row.isAbsent;
  if (row.isAbsent) row.score = null;
}

/** Paste a column of numbers; they map onto the rows in current display order. */
function applyPaste() {
  if (!sheet.value) return;
  const values = pasteText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  values.forEach((v, i) => {
    const row = sheet.value!.scores[i];
    if (!row) return;
    if (v === '' || v === '缺考' || v.toLowerCase() === 'a') {
      row.isAbsent = true;
      row.score = null;
    } else {
      const n = Number(v);
      if (!Number.isNaN(n)) {
        row.score = n;
        row.isAbsent = false;
      }
    }
  });

  showPaste.value = false;
  pasteText.value = '';
}

async function save() {
  if (!sheet.value) return;
  error.value = '';
  saving.value = true;
  saved.value = false;
  try {
    await api.put(`/exams/${props.examId}/scores`, {
      scores: sheet.value.scores.map((s) => ({
        studentId: s.studentId,
        score: s.isAbsent ? null : s.score,
        isAbsent: s.isAbsent,
      })),
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="sheet">
      <header class="page-header">
        <div>
          <h1>{{ sheet.exam.name }}</h1>
          <p class="hint">
            {{ sheet.exam.subject ?? '未设科目' }} · {{ sheet.exam.examDate }} · 满分
            {{ sheet.exam.fullScore }} · 已录入 {{ entered }} / {{ sheet.scores.length }}
          </p>
        </div>
        <div class="row">
          <button class="btn" @click="showPaste = !showPaste">粘贴一列分数</button>
          <button class="btn btn-primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存成绩' }}
          </button>
        </div>
      </header>

      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="saved" class="up">✓ 已保存</p>

      <div v-if="showPaste" class="card" style="margin-bottom: 16px">
        <div class="card-title">按当前顺序粘贴分数（每行一个，空行或「缺考」标记为缺考）</div>
        <textarea v-model="pasteText" class="textarea" style="font-family: monospace" />
        <div class="row" style="margin-top: 10px">
          <button class="btn btn-primary btn-sm" @click="applyPaste">应用</button>
          <button class="btn btn-sm" @click="showPaste = false">取消</button>
        </div>
      </div>

      <div v-if="liveStats" class="stat-grid" style="margin-bottom: 16px">
        <div class="stat">
          <div class="stat-label">参考人数</div>
          <div class="stat-value">{{ liveStats.attended }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">均分</div>
          <div class="stat-value">{{ liveStats.avg }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">最高 / 最低</div>
          <div class="stat-value">{{ liveStats.max }} / {{ liveStats.min }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">及格率</div>
          <div class="stat-value">{{ Math.round((liveStats.passRate ?? 0) * 100) }}%</div>
        </div>
        <div class="stat">
          <div class="stat-label">缺考</div>
          <div class="stat-value">{{ liveStats.absent }}</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 80px">学号</th>
              <th>姓名</th>
              <th style="width: 140px">分数</th>
              <th style="width: 90px">缺考</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in sheet.scores" :key="row.studentId" :class="{ absent: row.isAbsent }">
              <td>{{ row.studentNo ?? '—' }}</td>
              <td>{{ row.studentName }}</td>
              <td>
                <input
                  v-model.number="row.score"
                  class="input score-input"
                  type="number"
                  min="0"
                  :max="sheet.exam.fullScore"
                  :disabled="row.isAbsent"
                  step="0.5"
                  @keydown.enter.prevent="focusNext(i)"
                  @keydown.down.prevent="focusNext(i)"
                />
              </td>
              <td>
                <input type="checkbox" :checked="row.isAbsent" @change="toggleAbsent(row)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
tr.absent { background: #fffbeb; }
tr.absent td { color: var(--text-faint); }
.score-input { text-align: center; }
</style>
