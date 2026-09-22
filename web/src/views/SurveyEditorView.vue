<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/client';
import { surveysApi, surveyPublicUrl, surveyFieldTypes, surveyStatusLabels, type Survey, type SurveyField, type SurveyFieldType, type SurveyContent } from '@/api/surveys';
import SurveyFieldControl from '@/components/SurveyFieldControl.vue';

const route = useRoute();
const router = useRouter();
const survey = ref<Survey | null>(null);
const title = ref('');
const description = ref('');
const fields = ref<SurveyField[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const baseline = ref('');
const addType = ref<SurveyFieldType>('text');
const showPreview = ref(false);
const shareUrl = computed(() => survey.value ? surveyPublicUrl(survey.value.publicToken) : '');
const content = computed(() => ({ title: title.value, description: description.value, fields: fields.value }));
const dirty = computed(() => baseline.value !== JSON.stringify(content.value));
const fileCount = computed(() => fields.value.filter(f => f.type === 'file').length);
const canAdd = computed(() => fields.value.length < 50 && (addType.value !== 'file' || fileCount.value < 5));

function freshField(type: SurveyFieldType, label?: string, options?: string[]): SurveyField {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `f_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return { id, type, label: label ?? surveyFieldTypes.find(t => t.type === type)!.label, required: false, placeholder: '', ...(type === 'select' ? { options: options ?? ['选项一', '选项二'] } : {}) };
}
function adopt(data: Survey) {
  survey.value = data;
  title.value = data.title;
  description.value = data.description || '';
  fields.value = data.fields.map(f => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) }));
  baseline.value = JSON.stringify(content.value);
}
async function load() {
  error.value = '';
  notice.value = '';
  const id = String(route.params.id || '');
  if (id && survey.value?.id === id) return;
  if (!id) {
    survey.value = null;
    title.value = '';
    description.value = '';
    fields.value = [{ ...freshField('text', '姓名'), required: true }, freshField('phone', '联系电话')];
    baseline.value = JSON.stringify(content.value);
    return;
  }
  loading.value = true;
  try { adopt((await surveysApi.get(id)).data); }
  catch (e) { error.value = e instanceof ApiError ? e.message : '调查加载失败'; }
  finally { loading.value = false; }
}
function addField(type: SurveyFieldType, label?: string, options?: string[]) {
  if (fields.value.length >= 50 || (type === 'file' && fileCount.value >= 5)) return;
  fields.value.push(freshField(type, label, options));
}
function move(index: number, direction: number) {
  const next = index + direction;
  if (next < 0 || next >= fields.value.length) return;
  [fields.value[index], fields.value[next]] = [fields.value[next], fields.value[index]];
}
function changeType(field: SurveyField) {
  if (field.type === 'select' && !field.options?.length) field.options = ['选项一', '选项二'];
  if (field.type !== 'select') delete field.options;
}
function updateOptions(field: SurveyField, event: Event) {
  field.options = (event.target as HTMLTextAreaElement).value.split('\n');
}
function validatedContent(publish: boolean): SurveyContent | null {
  if (!title.value.trim()) { error.value = '请填写调查名称。'; return null; }
  if (publish && !fields.value.length) { error.value = '请至少添加一个题目后再发布。'; return null; }
  if (fileCount.value > 5) { error.value = '每个调查最多添加 5 个文件上传题目。'; return null; }
  const normalized = fields.value.map(f => ({ ...f, label: f.label.trim(), placeholder: f.placeholder?.trim(), ...(f.type === 'select' ? { options: f.options?.map(o => o.trim()).filter(Boolean) } : {}) }));
  for (let i = 0; i < normalized.length; i++) {
    const field = normalized[i];
    if (!field.label) { error.value = `请填写第 ${i + 1} 个题目的名称。`; return null; }
    if (field.type === 'select') {
      if (!field.options?.length || field.options.length > 100 || field.options.some(o => o.length > 120)) { error.value = `第 ${i + 1} 题需要 1–100 个选项，每项最多 120 字。`; return null; }
      if (new Set(field.options).size !== field.options.length) { error.value = `第 ${i + 1} 题的选项不能重复。`; return null; }
    }
  }
  return { title: title.value.trim(), description: description.value.trim(), fields: normalized };
}
async function save(publish = false) {
  if (saving.value) return;
  error.value = '';
  notice.value = '';
  const payload = validatedContent(publish || survey.value?.status === 'published');
  if (!payload) return;
  saving.value = true;
  try {
    if (survey.value) {
      adopt((await surveysApi.update(survey.value.id, { ...payload, version: survey.value.version, ...(publish ? { status: 'published' as const } : {}) })).data);
    } else {
      adopt((await surveysApi.create(payload)).data);
      // Persist the draft first; if publication fails it remains editable and recoverable.
      await router.replace(`/inbox/${survey.value!.id}/edit`);
      if (publish) adopt((await surveysApi.update(survey.value!.id, { version: survey.value!.version, status: 'published' })).data);
    }
    notice.value = publish ? '调查已发布。复制下方链接，即可邀请填写。' : survey.value?.status === 'published' ? '修改已保存，并已更新公开表单。' : '草稿已保存。';
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 409 ? '调查已在其他页面更新。请先复制保留当前修改，再刷新页面重新编辑。' : e instanceof ApiError ? e.message : '保存失败';
  } finally { saving.value = false; }
}
async function closeSurvey() {
  if (!survey.value || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const updated = (await surveysApi.update(survey.value.id, { version: survey.value.version, status: 'closed' })).data;
    // Closing a survey should not discard in-progress edits.
    survey.value = updated;
    notice.value = '调查已关闭，已提交的信息会保留。';
  } catch (e) { error.value = e instanceof ApiError ? e.message : '关闭失败'; }
  finally { saving.value = false; }
}
async function copyLink() {
  try { await navigator.clipboard.writeText(shareUrl.value); notice.value = '填写链接已复制。'; }
  catch { notice.value = '请选中下方链接后手动复制。'; }
}
onBeforeRouteLeave(() => !dirty.value || window.confirm('还有未保存的修改，确定离开吗？'));
watch(() => route.params.id, load, { immediate: true });
</script>

<template>
  <div class="page editor-page">
    <RouterLink class="back-link" to="/inbox">← 返回收集箱</RouterLink>
    <header class="page-header">
      <div class="row"><h1>{{ survey ? '编辑调查' : '新建调查' }}</h1><span v-if="survey" class="badge">{{ surveyStatusLabels[survey.status] }}</span><span v-if="dirty" class="hint">有未保存的修改</span></div>
      <div class="row">
        <button class="btn" @click="showPreview = !showPreview">{{ showPreview ? '收起预览' : '预览表单' }}</button>
        <RouterLink v-if="survey" class="btn" :to="`/inbox/${survey.id}/responses`">查看结果 · {{ survey.responseCount }}</RouterLink>
      </div>
    </header>
    <div v-if="loading" class="empty">正在加载表单…</div>
    <div v-else-if="route.params.id && !survey" class="card"><p class="error-text" role="alert">{{ error }}</p><button class="btn" @click="load">重新加载</button></div>
    <template v-else>
      <div v-if="survey?.status === 'published'" class="card publish-card">
        <div><strong>调查正在收集信息</strong><p class="hint">填写人无需登录。保存修改后，公开表单同步更新；历史提交保留原题目。</p></div>
        <div class="row"><input class="input link-input" aria-label="公开填写链接" :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()" /><button class="btn btn-primary" @click="copyLink">复制链接</button><a class="btn" :href="shareUrl" target="_blank" rel="noopener noreferrer">打开表单</a><button class="btn" :disabled="saving" @click="closeSurvey">关闭调查</button></div>
      </div>
      <div class="editor-layout" :class="{ 'with-preview': showPreview }">
        <form class="stack editor-form" autocomplete="off" @submit.prevent="save(false)">
          <fieldset :disabled="saving" class="editor-fieldset stack">
            <section class="card stack basics">
              <h2>调查信息</h2>
              <div class="field"><label for="survey-title">调查名称 <span class="error-text">*</span></label><input id="survey-title" v-model="title" class="input" placeholder="例如：新学期学生信息登记" maxlength="120" required autocomplete="off" /></div>
              <div class="field"><label for="survey-description">调查说明</label><textarea id="survey-description" v-model="description" class="textarea" placeholder="说明填写用途、填写要求或截止时间，让填写人更清楚地了解调查。" maxlength="5000" autocomplete="off" /></div>
            </section>
            <section class="card add-card">
              <div class="row"><h2>表单题目</h2><span class="spacer" /><span class="hint">{{ fields.length }} / 50 题</span></div>
              <p class="hint">快捷添加常用题目，再自由调整题名、顺序与必填项。</p>
              <div class="row quick-add">
                <button type="button" class="btn btn-sm" :disabled="fields.length >= 50" @click="addField('text', '姓名')">+ 姓名</button>
                <button type="button" class="btn btn-sm" :disabled="fields.length >= 50" @click="addField('phone', '联系电话')">+ 电话</button>
                <button type="button" class="btn btn-sm" :disabled="fields.length >= 50" @click="addField('idcard', '身份证号')">+ 身份证</button>
                <button type="button" class="btn btn-sm" :disabled="fields.length >= 50" @click="addField('select', '年级', ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'])">+ 年级</button>
                <button type="button" class="btn btn-sm" :disabled="fields.length >= 50 || fileCount >= 5" @click="addField('file', '上传附件')">+ 附件</button>
              </div>
              <div class="row custom-add"><select v-model="addType" class="select type-select" aria-label="新增题目类型"><option v-for="item in surveyFieldTypes" :key="item.type" :value="item.type">{{ item.label }}</option></select><button type="button" class="btn" :disabled="!canAdd" @click="addField(addType)">添加题目</button><span class="hint">附件 {{ fileCount }} / 5</span></div>
            </section>
            <p v-if="!fields.length" class="empty-inline">还没有题目，从上方添加第一个吧。</p>
            <article v-for="(field, index) in fields" :key="field.id" class="card field-editor">
              <div class="row field-top"><span class="question-number">{{ String(index + 1).padStart(2, '0') }}</span><span class="hint">{{ surveyFieldTypes.find(t => t.type === field.type)?.label }}</span><span class="spacer" /><button type="button" class="btn btn-sm" :disabled="index === 0" :aria-label="`上移第 ${index + 1} 题`" @click="move(index, -1)">↑</button><button type="button" class="btn btn-sm" :disabled="index === fields.length - 1" :aria-label="`下移第 ${index + 1} 题`" @click="move(index, 1)">↓</button><button type="button" class="btn btn-sm btn-danger" :aria-label="`删除第 ${index + 1} 题`" @click="fields.splice(index, 1)">删除</button></div>
              <div class="field-config">
                <div class="field"><label :for="`label-${field.id}`">题目名称</label><input :id="`label-${field.id}`" v-model="field.label" class="input" maxlength="100" required autocomplete="off" /></div>
                <div class="field"><label :for="`type-${field.id}`">题目类型</label><select :id="`type-${field.id}`" v-model="field.type" class="select" @change="changeType(field)"><option v-for="item in surveyFieldTypes" :key="item.type" :value="item.type" :disabled="item.type === 'file' && field.type !== 'file' && fileCount >= 5">{{ item.label }}</option></select></div>
              </div>
              <div v-if="field.type !== 'file'" class="field placeholder-field"><label :for="`placeholder-${field.id}`">填写提示（选填）</label><input :id="`placeholder-${field.id}`" v-model="field.placeholder" class="input" placeholder="例如：请填写学生的真实姓名" maxlength="200" autocomplete="off" /></div>
              <div v-if="field.type === 'select'" class="field options-field"><label :for="`options-${field.id}`">选项，每行一项</label><textarea :id="`options-${field.id}`" class="textarea" :value="field.options?.join('\n')" rows="4" autocomplete="off" @input="updateOptions(field, $event)" /><span class="hint">最多 100 项，每项最多 120 字。</span></div>
              <p v-if="field.type === 'file'" class="hint">每位填写人可上传 1 个文件，最大 10 MB。</p>
              <p v-if="field.type === 'idcard'" class="hint">支持中国大陆 18 位身份证号及旧版 15 位号码。</p>
              <label class="required-toggle"><input v-model="field.required" type="checkbox" /> 此题必填</label>
            </article>
          </fieldset>
          <div class="save-bar card">
            <div v-if="error || notice" class="save-message"><p v-if="error" class="error-text" role="alert">{{ error }}</p><p v-if="notice" class="hint" role="status">{{ notice }}</p></div>
            <div class="row"><span class="hint save-hint">{{ survey?.status === 'published' ? '保存后更新公开表单' : '保存草稿后可以继续编辑' }}</span><span class="spacer" /><button type="submit" class="btn" :disabled="saving">{{ saving ? '保存中…' : survey?.status === 'published' ? '保存修改' : '保存草稿' }}</button><button v-if="survey?.status !== 'published'" type="button" class="btn btn-primary" :disabled="saving" @click="save(true)">{{ survey?.status === 'closed' ? '保存并重新发布' : '保存并发布' }}</button></div>
          </div>
        </form>
        <aside v-if="showPreview" class="preview-pane"><div class="preview-caption"><span class="badge">填写人视角</span><span class="hint">仅预览，不会提交</span></div><div class="card preview-card"><h2>{{ title || '未命名调查' }}</h2><p v-if="description" class="preview-description hint">{{ description }}</p><div class="stack preview-fields"><SurveyFieldControl v-for="field in fields" :key="field.id" :field="field" preview disabled /><p v-if="!fields.length" class="hint">添加题目后将在这里预览</p></div><button class="btn btn-primary btn-block" disabled>提交信息</button></div></aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.editor-page { max-width: 1160px; }
.back-link { display: inline-block; margin-bottom: 14px; font-size: 13px; }
.editor-layout { max-width: 840px; margin: 0 auto; }
.editor-layout.with-preview { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.8fr); gap: 22px; max-width: none; align-items: start; }
.editor-form, .editor-fieldset { min-width: 0; }
.editor-fieldset { padding: 0; margin: 0; border: 0; }
.basics, .add-card, .field-editor { padding: 22px; }
.publish-card { margin-bottom: 22px; background: var(--brand-soft); box-shadow: none; }
.publish-card p { margin: 5px 0 14px; }
.link-input { flex: 1; min-width: 180px; }
.type-select { width: 150px; }
.custom-add { padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--border); }
.quick-add { gap: 7px; }
.field-top { gap: 6px; margin-bottom: 15px; }
.question-number { font-size: 16px; font-weight: 600; color: var(--brand); margin-right: 6px; }
.field-config { display: grid; grid-template-columns: minmax(0, 1fr) 145px; gap: 12px; }
.placeholder-field, .options-field { margin-top: 14px; }
.required-toggle { display: flex; gap: 7px; align-items: center; font-size: 13px; margin-top: 15px; cursor: pointer; }
.required-toggle input { accent-color: var(--brand); }
.save-bar { position: sticky; bottom: 12px; z-index: 2; box-shadow: var(--shadow-lg); }
.save-message p { margin: 0 0 10px; }
.save-hint { font-size: 12px; }
.preview-pane { position: sticky; top: 20px; min-width: 0; }
.preview-caption { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.preview-card { padding: 24px; border-top: 4px solid var(--brand); }
.preview-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.preview-fields { margin: 25px 0; }
.preview-card h2 { overflow-wrap: anywhere; }
@media (max-width: 980px) { .editor-layout.with-preview { grid-template-columns: minmax(0, 1fr); }.preview-pane { position: static; grid-row: 1; }.preview-fields { max-height: 400px; overflow-y: auto; } }
@media (max-width: 768px) { .save-bar { bottom: calc(var(--nav-height) + 10px + env(safe-area-inset-bottom)); }.save-hint { display: none; }.basics, .add-card, .field-editor { padding: 16px; } }
@media (max-width: 420px) { .field-config { grid-template-columns: 1fr; }.save-bar { padding: 12px; }.save-bar .row { gap: 6px; }.save-bar .btn { padding: 8px 10px; } }
</style>
