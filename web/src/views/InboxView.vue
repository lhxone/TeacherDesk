<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '@/api/client';
import { surveysApi, surveyPublicUrl, surveyStatusLabels, type Survey, type SurveyStatus } from '@/api/surveys';
import EmptyState from '@/components/EmptyState.vue';

const surveys = ref<Survey[]>([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref('');
const filter = ref<SurveyStatus | 'all'>('all');
const search = ref('');
const shareUrl = ref('');
const filtered = computed(() => surveys.value.filter(s =>
  (filter.value === 'all' || s.status === filter.value) && s.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const totalResponses = computed(() => surveys.value.reduce((sum, s) => sum + s.responseCount, 0));
async function load() {
  loading.value = true;
  error.value = '';
  try { surveys.value = (await surveysApi.list()).data; }
  catch (e) { error.value = e instanceof ApiError ? e.message : '调查加载失败'; }
  finally { loading.value = false; }
}
async function changeStatus(survey: Survey) {
  busy.value = survey.id;
  error.value = '';
  notice.value = '';
  try {
    const { data } = await surveysApi.update(survey.id, { version: survey.version, status: survey.status === 'published' ? 'closed' : 'published' });
    surveys.value = surveys.value.map(s => s.id === data.id ? data : s);
    notice.value = data.status === 'published' ? '调查已发布，可以分享链接收集信息。' : '调查已关闭，已提交的信息会保留。';
  } catch (e) { error.value = e instanceof ApiError ? e.message : '操作失败'; }
  finally { busy.value = ''; }
}
async function copyLink(survey: Survey) {
  shareUrl.value = surveyPublicUrl(survey.publicToken);
  try { await navigator.clipboard.writeText(shareUrl.value); notice.value = '填写链接已复制，可发送给填写人。'; }
  catch { notice.value = '请在下方选中并复制填写链接。'; }
}
async function remove(survey: Survey) {
  if (!window.confirm(`确定删除「${survey.title}」吗？删除后填写链接失效，调查和回收结果将不再显示。`)) return;
  busy.value = survey.id;
  error.value = '';
  try { await surveysApi.remove(survey.id); surveys.value = surveys.value.filter(s => s.id !== survey.id); notice.value = '调查已删除。'; shareUrl.value = ''; }
  catch (e) { error.value = e instanceof ApiError ? e.message : '删除失败'; }
  finally { busy.value = ''; }
}
onMounted(load);
</script>

<template>
  <div class="page inbox-page">
    <header class="page-header">
      <div><h1>收集箱</h1><p class="hint intro">创建信息调查，分享链接即可填写，无需登录。</p></div>
      <RouterLink class="btn btn-primary" to="/inbox/new">+ 新建调查</RouterLink>
    </header>
    <div class="stat-grid inbox-stats">
      <div class="stat"><div class="stat-label">全部调查</div><div class="stat-value">{{ surveys.length }}</div></div>
      <div class="stat"><div class="stat-label">正在收集</div><div class="stat-value active-count">{{ surveys.filter(s => s.status === 'published').length }}</div></div>
      <div class="stat"><div class="stat-label">已收集信息</div><div class="stat-value">{{ totalResponses }} <small>份</small></div></div>
    </div>
    <div class="list-toolbar row">
      <input v-model="search" class="input search" type="search" placeholder="搜索调查名称" aria-label="搜索调查名称" autocomplete="off" />
      <select v-model="filter" class="select status-filter" aria-label="调查状态"><option value="all">全部状态</option>
        <option value="published">收集中</option><option value="draft">草稿</option><option value="closed">已关闭</option>
      </select>
      <button class="btn" :disabled="loading" @click="load">刷新</button>
    </div>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="notice" class="hint" role="status">{{ notice }}</p>
    <div v-if="shareUrl" class="card share-card field"><label for="inbox-share">填写链接</label><input id="inbox-share" class="input" :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()" /></div>
    <div v-if="loading" class="empty">正在加载调查…</div>
    <EmptyState v-else-if="!surveys.length && !error" icon="exam" title="把零散的信息，收进一个表单">
      <p>姓名、电话、年级或附件，按需要自由组合。</p><RouterLink class="btn btn-primary" to="/inbox/new">创建第一份调查</RouterLink>
    </EmptyState>
    <p v-else-if="!filtered.length && !error" class="empty">没有找到符合条件的调查</p>
    <div v-else class="survey-grid">
      <article v-for="survey in filtered" :key="survey.id" class="card survey-card">
        <div class="row"><span class="badge" :class="survey.status">{{ surveyStatusLabels[survey.status] }}</span><span class="spacer" /><span class="hint">{{ survey.fields.length }} 个题目</span></div>
        <RouterLink :to="`/inbox/${survey.id}/edit`" class="survey-title"><h2>{{ survey.title }}</h2></RouterLink>
        <p class="description hint">{{ survey.description || '未添加调查说明' }}</p>
        <RouterLink :to="`/inbox/${survey.id}/responses`" class="response-summary"><strong>{{ survey.responseCount }}</strong><span>份已提交信息 <span aria-hidden="true">→</span></span></RouterLink>
        <p class="hint date">更新于 {{ new Date(survey.updatedAt).toLocaleDateString('zh-CN') }}</p>
        <div class="survey-actions">
          <RouterLink class="btn btn-sm" :to="`/inbox/${survey.id}/edit`">编辑表单</RouterLink>
          <RouterLink class="btn btn-sm" :to="`/inbox/${survey.id}/responses`">查看结果</RouterLink>
          <button v-if="survey.status === 'published'" class="btn btn-sm" @click="copyLink(survey)">复制链接</button>
          <button class="btn btn-sm" :disabled="!!busy" @click="changeStatus(survey)">{{ busy === survey.id ? '处理中…' : survey.status === 'published' ? '关闭调查' : survey.status === 'closed' ? '重新发布' : '发布' }}</button>
          <button class="btn btn-sm btn-danger" :disabled="!!busy" @click="remove(survey)">删除</button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.intro { margin: 6px 0 0; }
.inbox-stats { max-width: 660px; margin-bottom: 24px; }
.stat-value small { font-size: 12px; font-weight: 400; color: var(--text-muted); }
.active-count { color: var(--brand); }
.list-toolbar { margin-bottom: 20px; }
.search { max-width: 320px; }
.status-filter { width: 130px; }
.survey-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 18px; }
.survey-card { display: flex; flex-direction: column; padding: 20px; }
.survey-title { margin-top: 17px; color: var(--text); overflow-wrap: anywhere; }
.description { margin: 10px 0 20px; min-height: 42px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.response-summary { display: flex; gap: 10px; align-items: baseline; margin-top: auto; color: var(--text-muted); }
.response-summary strong { font-size: 30px; color: var(--text); font-weight: 600; }
.response-summary span { font-size: 13px; }
.date { margin: 10px 0 16px; }
.survey-actions { display: flex; flex-wrap: wrap; gap: 7px; border-top: 1px solid var(--border); padding-top: 15px; }
.badge.published { color: var(--success); background: var(--hover-tint); }
.badge.draft, .badge.closed { color: var(--text-muted); background: var(--hover-tint); }
.share-card { margin-bottom: 18px; }
@media (max-width: 500px) { .search { max-width: none; }.status-filter { flex: 1; }.inbox-stats { gap: 8px; }.stat { padding: 10px; } }
</style>
