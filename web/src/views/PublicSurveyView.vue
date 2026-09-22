<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '@/api/client';
import { publicSurveysApi, type PublicSurvey, type SurveyField } from '@/api/surveys';
import SurveyFieldControl from '@/components/SurveyFieldControl.vue';

const route = useRoute();
const survey = ref<PublicSurvey | null>(null);
const answers = ref<Record<string, string>>({});
const files = ref<Record<string, File>>({});
const fieldErrors = ref<Record<string, string>>({});
const loading = ref(true);
const submitting = ref(false);
const submitted = ref(false);
const unavailable = ref(false);
const outdated = ref(false);
const error = ref('');
const token = computed(() => String(route.params.token || ''));
const completed = computed(() => survey.value?.fields.filter(f => f.type === 'file' ? !!files.value[f.id] : !!answers.value[f.id]?.trim()).length ?? 0);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  survey.value = null;
  answers.value = {};
  files.value = {};
  fieldErrors.value = {};
  error.value = '';
  outdated.value = false;
  unavailable.value = false;
  submitted.value = false;
  try {
    const { data } = await publicSurveysApi.get(token.value);
    if (sequence !== loadSequence) return;
    survey.value = data;
    answers.value = Object.fromEntries(data.fields.filter(f => f.type !== 'file').map(f => [f.id, '']));
  } catch (e) {
    if (sequence !== loadSequence) return;
    unavailable.value = e instanceof ApiError && (e.status === 404 || e.status === 410 || e.status === 403);
    error.value = unavailable.value ? '调查尚未发布、已关闭或链接已失效。请联系发布者确认。' : e instanceof ApiError ? e.message : '调查加载失败，请稍后重试。';
  } finally { if (sequence === loadSequence) loading.value = false; }
}
function selectFile(field: SurveyField, file: File | null, input: HTMLInputElement) {
  delete fieldErrors.value[field.id];
  if (!file) { delete files.value[field.id]; return; }
  if (file.size > 10 * 1024 * 1024) {
    fieldErrors.value[field.id] = '文件超过 10 MB，请选择较小的文件。';
    input.value = '';
    delete files.value[field.id];
    return;
  }
  files.value[field.id] = file;
}
async function submit() {
  if (!survey.value || submitting.value || outdated.value) return;
  error.value = '';
  // Keep local file validation failures visible until that file is corrected.
  if (Object.values(fieldErrors.value).some(Boolean)) { error.value = '请先处理标注的问题后再提交。'; return; }
  submitting.value = true;
  try {
    await publicSurveysApi.submit(token.value, survey.value.version, answers.value, files.value);
    submitted.value = true;
    answers.value = {};
    files.value = {};
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      outdated.value = true;
      error.value = '发布者已修改表单，请重新加载最新题目后填写。重新加载会清空当前填写内容。';
    } else if (e instanceof ApiError && (e.status === 404 || e.status === 410 || e.status === 403)) {
      unavailable.value = true;
      error.value = '调查已关闭或链接已失效，当前信息未提交。请联系发布者确认。';
    } else {
      error.value = e instanceof ApiError ? e.message : '提交失败，请稍后重试。';
      if (e instanceof ApiError && e.details?.length) error.value += ` ${e.details.map(d => d.message).join('；')}`;
    }
  } finally { submitting.value = false; }
}
watch(token, load, { immediate: true });
</script>

<template>
  <main class="public-survey">
    <div class="public-brand"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16v12l-4 4H4V4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 9h8M8 13h5M16 20v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>TeacherDesk · 信息收集</span></div>
    <div v-if="loading" class="card public-state" aria-live="polite"><span class="loading-dot" /><h1>正在加载调查</h1><p class="hint">请稍候…</p></div>
    <div v-else-if="submitted" class="card public-state success-state" role="status"><div class="state-icon success-icon"><svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8 16 5 5 11-11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h1>提交成功</h1><p>感谢填写「{{ survey?.title }}」</p><p class="hint">您的信息已交给发布者，可以关闭此页面。</p></div>
    <div v-else-if="unavailable || !survey" class="card public-state"><div class="state-icon">—</div><h1>{{ unavailable ? '调查暂未开放' : '暂时无法加载' }}</h1><p class="hint" role="alert">{{ error }}</p><button class="btn" @click="load">重新加载</button></div>
    <template v-else>
      <header class="card public-header"><span class="badge">信息调查</span><h1>{{ survey.title }}</h1><p v-if="survey.description" class="survey-description">{{ survey.description }}</p><div class="header-meta"><span>无需登录，填写后直接提交</span><span><span class="required">*</span> 为必填项</span></div></header>
      <form class="public-form" autocomplete="off" @submit.prevent="submit">
        <fieldset :disabled="submitting || outdated" class="public-fieldset">
          <section v-for="(field, index) in survey.fields" :key="field.id" class="card question-card"><div class="question-count">{{ String(index + 1).padStart(2, '0') }}</div><div class="question-body"><SurveyFieldControl v-model="answers[field.id]" :field="field" :disabled="submitting || outdated" @file="(file, input) => selectFile(field, file, input)" /><p v-if="field.type === 'idcard'" class="hint field-hint">请填写中国大陆 18 位身份证号或旧版 15 位号码。</p><p v-if="files[field.id]" class="hint file-selected">已选择：{{ files[field.id].name }}</p><p v-if="fieldErrors[field.id]" class="error-text" role="alert">{{ fieldErrors[field.id] }}</p></div></section>
        </fieldset>
        <section class="card submission-card"><p v-if="error" class="error-text" role="alert">{{ error }}</p><button v-if="outdated" class="btn btn-block" type="button" @click="load">重新加载表单（清空当前填写）</button><template v-else><div class="row submission-top"><span class="hint">已填写 {{ completed }} / {{ survey.fields.length }} 题</span><span class="spacer" /><span class="hint">请确认信息无误</span></div><button class="btn btn-primary btn-lg btn-block" type="submit" :disabled="submitting">{{ submitting ? '正在提交，请稍候…' : '提交信息' }}</button><p class="hint submission-note">{{ submitting ? '附件较大时可能需要一些时间，请保持页面打开。' : '提交后，信息与附件将发送给此调查的发布者。' }}</p></template></section>
      </form>
    </template>
    <footer class="public-footer">TeacherDesk 提供表单服务</footer>
  </main>
</template>

<style scoped>
.public-survey { max-width: 720px; margin: 0 auto; padding: 32px 20px max(24px, env(safe-area-inset-bottom)); }
.public-brand { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; letter-spacing: 0.3px; color: var(--text-muted); margin-bottom: 24px; }
.public-brand svg { color: var(--brand); }
.public-header { padding: 30px; border-top: 5px solid var(--brand); margin-bottom: 18px; }
.public-header h1 { margin: 17px 0 16px; font-size: 25px; line-height: 1.5; overflow-wrap: anywhere; }
.survey-description { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-muted); line-height: 1.9; margin-bottom: 24px; }
.header-meta { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 17px; font-size: 12px; color: var(--text-muted); }
.required { color: var(--danger); }
.public-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.question-card { display: flex; gap: 15px; padding: 24px 28px; margin-bottom: 14px; }
.question-count { color: var(--text-faint); font-size: 12px; line-height: 23px; font-variant-numeric: tabular-nums; }
.question-body { min-width: 0; flex: 1; }
.question-body :deep(.field) { gap: 12px; }
.question-body :deep(.input), .question-body :deep(.textarea), .question-body :deep(.select) { padding: 11px 12px; }
.file-selected { overflow-wrap: anywhere; margin-bottom: 0; }
.field-hint { font-size: 12px; margin-bottom: 0; }
.submission-card { padding: 24px 28px; margin-top: 20px; }
.submission-top { margin-bottom: 16px; }
.submission-note { text-align: center; font-size: 12px; margin: 14px 0 0; }
.public-footer { text-align: center; color: var(--text-faint); font-size: 12px; margin-top: 25px; }
.public-state { padding: 56px 30px; text-align: center; margin-top: 40px; }
.public-state h1 { margin-bottom: 16px; }
.public-state p { overflow-wrap: anywhere; }
.public-state .hint { margin-bottom: 24px; }
.state-icon { margin: 0 auto 24px; width: 68px; height: 68px; display: grid; place-items: center; border-radius: 50%; background: var(--hover-tint); color: var(--text-muted); font-size: 28px; }
.success-icon { background: var(--brand-soft); color: var(--brand); }
.loading-dot { width: 10px; height: 10px; background: var(--brand); border-radius: 50%; display: inline-block; margin-bottom: 20px; }
@media (max-width: 600px) { .public-survey { padding: 22px 14px max(22px, env(safe-area-inset-bottom)); }.public-header { padding: 22px; }.public-header h1 { font-size: 22px; }.question-card { padding: 20px 18px; gap: 10px; }.submission-card { padding: 20px; }.public-state { padding: 42px 20px; }.question-body :deep(.input), .question-body :deep(.textarea), .question-body :deep(.select) { font-size: 16px; } }
</style>
