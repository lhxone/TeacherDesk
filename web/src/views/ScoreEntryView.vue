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

/** One CSV field: quote if it contains a comma, quote, or newline. */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Split one CSV line into fields, honoring double-quoted fields with escaped quotes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/** Download a CSV template pre-filled with student no/name for the teacher to fill in offline. */
function downloadTemplate() {
  if (!sheet.value) return;
  const lines = [
    ['学号', '姓名', '分数', '缺考'],
    ...sheet.value.scores.map((s) => [
      s.studentNo ?? '',
      s.studentName,
      s.score != null ? String(s.score) : '',
      s.isAbsent ? '是' : '',
    ]),
  ];
  const csv = lines.map((row) => row.map(csvField).join(',')).join('\r\n');
  // Prefix a BOM so Excel/WPS open the UTF-8 file with Chinese text intact.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${sheet.value.exam.name}-成绩模板.csv`;
  a.click();
  URL.revokeObjectURL(href);
}

function pickImportFile() {
  importError.value = '';
  fileInput.value?.click();
}

/** Import a filled-in template: match rows by 学号, falling back to 姓名. */
async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !sheet.value) return;

  importError.value = '';
  try {
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map(parseCsvLine);
    if (!rows.length) {
      importError.value = '模板文件为空';
      return;
    }

    // Skip a header row if present (first cell isn't a known student no or name).
    const header = rows[0];
    const looksLikeHeader = header[0] === '学号' || header[1] === '姓名';
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;

    const byNo = new Map(sheet.value.scores.map((s) => [s.studentNo, s]));
    const byName = new Map(sheet.value.scores.map((s) => [s.studentName, s]));

    let matched = 0;
    for (const cols of dataRows) {
      const [no, name, scoreText, absentText] = cols;
      const row = (no && byNo.get(no)) || (name && byName.get(name));
      if (!row) continue;
      matched++;

      const absent = ['是', 'y', 'yes', 'true', '1'].includes((absentText ?? '').trim().toLowerCase());
      const trimmedScore = (scoreText ?? '').trim();
      if (absent || trimmedScore === '' || trimmedScore === '缺考') {
        row.isAbsent = true;
        row.score = null;
      } else {
        const n = Number(trimmedScore);
        if (!Number.isNaN(n)) {
          row.score = n;
          row.isAbsent = false;
        }
      }
    }

    if (!matched) {
      importError.value = '未匹配到任何学生，请确认使用的是本考试导出的模板';
    }
  } catch {
    importError.value = '导入失败，请检查文件格式';
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
            accept=".csv,text/csv"
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
