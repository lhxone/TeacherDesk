<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '@/api/client';
import { responsesCsv, saveBlob, surveysApi, surveyPublicUrl, surveyStatusLabels, type Survey, type SurveyResponse } from '@/api/surveys';
import EmptyState from '@/components/EmptyState.vue';

const route = useRoute();
const survey = ref<Survey | null>(null);
const responses = ref<SurveyResponse[]>([]);
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const exporting = ref(false);
const downloading = ref('');
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
let loadSequence = 0;

async function load(nextPage = page.value) {
  const sequence = ++loadSequence;
  loading.value = true;
  error.value = '';
  try {
    const id = String(route.params.id);
    const [info, result] = await Promise.all([surveysApi.get(id), surveysApi.responses(id, nextPage, pageSize)]);
    if (sequence !== loadSequence) return;
    survey.value = info.data;
    responses.value = result.data;
    total.value = result.meta.total;
    page.value = nextPage;
  } catch (e) { if (sequence === loadSequence) error.value = e instanceof ApiError ? e.message : '回收结果加载失败'; }
  finally { if (sequence === loadSequence) loading.value = false; }
}
function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function formatSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`; }
async function download(file: SurveyResponse['files'][number]) {
  if (!survey.value) return;
  downloading.value = file.id;
  error.value = '';
  try { await surveysApi.download(survey.value.id, file); }
  catch (e) { error.value = e instanceof ApiError ? e.message : '附件下载失败'; }
  finally { downloading.value = ''; }
}
async function exportCsv() {
  if (!survey.value || exporting.value) return;
  exporting.value = true;
  error.value = '';
  notice.value = '';
  try {
    const rows = await surveysApi.allResponses(survey.value.id);
    const filename = `${survey.value.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}-回收结果.csv`;
    saveBlob(new Blob([responsesCsv(rows)], { type: 'text/csv;charset=utf-8;' }), filename);
    notice.value = `已导出 ${rows.length} 份提交。附件以文件名列出，可在提交详情中下载。`;
  } catch (e) { error.value = e instanceof ApiError ? e.message : '导出失败'; }
  finally { exporting.value = false; }
}
watch(() => route.params.id, () => { survey.value = null; responses.value = []; load(1); }, { immediate: true });
</script>

<template>
  <div class="page responses-page">
    <RouterLink class="back-link" to="/inbox">← 返回收集箱</RouterLink>
    <header class="page-header">
      <div><div class="row"><h1>{{ survey?.title || '回收结果' }}</h1><span v-if="survey" class="badge">{{ surveyStatusLabels[survey.status] }}</span></div><p class="hint intro">已收集 <strong>{{ total }}</strong> 份信息 · 每份提交保留填写时的题目</p></div>
      <div class="row"><button class="btn" :disabled="loading" @click="load()">刷新</button><RouterLink v-if="survey" class="btn" :to="`/inbox/${survey.id}/edit`">编辑表单</RouterLink><button class="btn btn-primary" :disabled="!survey || exporting || !total" @click="exportCsv">{{ exporting ? '正在导出全部…' : '导出全部 CSV' }}</button></div>
    </header>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="notice" class="hint" role="status">{{ notice }}</p>
    <div v-if="loading" class="empty">正在加载回收结果…</div>
    <EmptyState v-else-if="!responses.length && !error" icon="exam" title="还没有人提交信息">
      <p>{{ survey?.status === 'published' ? '将填写链接分享出去，提交的信息会显示在这里。' : '发布调查后，就可以通过链接收集信息。' }}</p>
      <RouterLink v-if="survey" class="btn" :to="`/inbox/${survey.id}/edit`">{{ survey.status === 'published' ? '获取填写链接' : '前往发布' }}</RouterLink>
    </EmptyState>
    <template v-else-if="responses.length">
      <div class="row results-toolbar"><span class="hint">本页 {{ responses.length }} 份 · 点击展开提交详情</span><span class="spacer" /><a v-if="survey?.status === 'published'" :href="surveyPublicUrl(survey.publicToken)" target="_blank" rel="noopener noreferrer">查看公开表单 ↗</a></div>
      <div class="stack response-list">
        <details v-for="(response, index) in responses" :key="response.id" class="card response-card" :open="responses.length === 1">
          <summary><span class="response-index">{{ (page - 1) * pageSize + index + 1 }}</span><div class="summary-info"><strong>{{ response.fields.find(f => f.type !== 'file' && response.answers[f.id]) ? response.answers[response.fields.find(f => f.type !== 'file' && response.answers[f.id])!.id] : '信息提交' }}</strong><span class="hint">{{ formatDate(response.createdAt) }}</span></div><span v-if="response.files.length" class="badge attachment-badge">{{ response.files.length }} 个附件</span><span class="expand-label hint">详情 <span class="chevron" aria-hidden="true">⌄</span></span></summary>
          <div class="response-detail"><div class="row detail-caption"><span class="hint">以下为提交时的表单内容</span><span class="spacer" /><span class="hint response-id">编号 {{ response.id }}</span></div>
            <dl class="answers">
              <div v-for="field in response.fields" :key="field.id" class="answer-row"><dt>{{ field.label }}</dt><dd>
                <template v-if="field.type === 'file'"><button v-for="file in response.files.filter(f => f.fieldId === field.id)" :key="file.id" class="file-download" :disabled="!!downloading" @click="download(file)"><span class="file-name">{{ file.originalFilename }}</span><span class="hint">{{ formatSize(file.fileSize) }}</span><span>{{ downloading === file.id ? '下载中…' : '下载 ↓' }}</span></button><span v-if="!response.files.some(f => f.fieldId === field.id)" class="hint">未上传</span></template>
                <span v-else :class="{ hint: !response.answers[field.id] }">{{ response.answers[field.id] || '未填写' }}</span>
              </dd></div>
            </dl>
          </div>
        </details>
      </div>
      <div class="pagination row"><span class="hint">共 {{ total }} 份 · 第 {{ page }} / {{ totalPages }} 页</span><span class="spacer" /><button class="btn" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button><button class="btn" :disabled="page >= totalPages || loading" @click="load(page + 1)">下一页</button></div>
    </template>
  </div>
</template>

<style scoped>
.responses-page { max-width: 1040px; }
.back-link { display: inline-block; margin-bottom: 14px; font-size: 13px; }
.intro { margin: 8px 0 0; }
.page-header h1 { overflow-wrap: anywhere; }
.results-toolbar { margin: 22px 0 12px; font-size: 13px; }
.response-list { gap: 12px; }
.response-card { padding: 0; overflow: hidden; }
summary { display: flex; align-items: center; gap: 14px; padding: 18px 20px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
.response-index { flex-shrink: 0; background: var(--brand-soft); color: var(--brand); width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; }
.summary-info { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
.summary-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; font-weight: 500; }
.expand-label { white-space: nowrap; }
.chevron { display: inline-block; margin-left: 6px; }
details[open] .chevron { transform: rotate(180deg); }
.response-detail { border-top: 1px solid var(--border); padding: 18px 20px; }
.detail-caption { align-items: flex-start; }
.response-id { font-size: 11px; overflow-wrap: anywhere; }
.answers { margin: 14px 0 0; }
.answer-row { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.answer-row:last-child { border-bottom: 0; }
dt { color: var(--text-muted); overflow-wrap: anywhere; }
dd { margin: 0; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.file-download { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; border: 1px solid var(--border); background: var(--bg); border-radius: 7px; padding: 8px 12px; color: var(--brand); max-width: 100%; text-align: left; }
.file-download:disabled { opacity: 0.6; cursor: wait; }
.file-name { color: var(--text); overflow-wrap: anywhere; }
.pagination { margin-top: 24px; }
@media (max-width: 600px) { summary { gap: 10px; padding: 15px; }.response-detail { padding: 15px; }.answer-row { grid-template-columns: 1fr; gap: 6px; }.attachment-badge { display: none; }.response-id { flex-basis: 100%; } }
</style>
