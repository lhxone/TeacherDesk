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
const importError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

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

/** Download an Excel template pre-filled with the roster for the teacher to fill in offline. */
function downloadTemplate() {
  if (!sheet.value) return;
  api
    .blob(`/exams/${props.examId}/scores/template`)
    .then((blob) => {
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${sheet.value?.exam.name ?? 'exam'}-成绩模板.xlsx`;
      a.click();
      URL.revokeObjectURL(href);
    })
    .catch(() => (importError.value = '模板下载失败'));
}

function pickImportFile() {
  importError.value = '';
  fileInput.value?.click();
}

type ImportedScore = { studentId: string; score: number | null; isAbsent: boolean };

/** Upload a filled-in Excel template; the server matches rows by 学号, falling back to 姓名. */
async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !sheet.value) return;

  importError.value = '';
  try {
    const res = await api.upload<Envelope<{ matched: number; skipped: string[]; scores: ImportedScore[] }>>(
      `/exams/${props.examId}/scores/import-file`,
      file,
    );
    const byId = new Map(sheet.value.scores.map((s) => [s.studentId, s]));
    for (const update of res.data.scores) {
      const row = byId.get(update.studentId);
      if (!row) continue;
      row.score = update.score;
      row.isAbsent = update.isAbsent;
    }
    if (res.data.skipped.length) {
      importError.value = `已导入 ${res.data.matched} 人，未匹配：${res.data.skipped.join('、')}`;
    }
  } catch (err) {
    importError.value = err instanceof ApiError ? err.message : '导入失败，请检查文件格式';
  }
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
          <button class="btn" @click="downloadTemplate">下载模板</button>
          <button class="btn" @click="pickImportFile">导入模板</button>
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx"
            style="display: none"
            @change="handleImportFile"
          />
          <button class="btn btn-primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存成绩' }}
          </button>
        </div>
      </header>

      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="importError" class="error-text">{{ importError }}</p>
      <p v-if="saved" class="up">✓ 已保存</p>

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
