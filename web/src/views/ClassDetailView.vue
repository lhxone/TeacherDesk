<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError, fetchAllPages } from '@/api/client';
import ModalDialog from '@/components/ModalDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { ClassItem, Envelope, Exam, Paged, Student, Tag } from '@/api/types';

const props = defineProps<{ classId: string }>();

type Tab = 'students' | 'exams';
const tab = ref<Tab>('students');

const cls = ref<ClassItem | null>(null);
const students = ref<Student[]>([]);
const exams = ref<Exam[]>([]);
const tags = ref<Tag[]>([]);
const loading = ref(true);
const search = ref('');
const error = ref('');

// --- student form ---
const showStudentForm = ref(false);
const editingStudent = ref<Student | null>(null);
const studentForm = ref({
  name: '',
  studentNo: '',
  gender: '' as string,
  phone: '',
  qq: '',
  note: '',
  tagIds: [] as string[],
});
const newTagName = ref('');
const creatingTag = ref(false);

// --- bulk import ---
const showImport = ref(false);
const importText = ref('');
const importPreview = ref<{ total: number; valid: number; invalid: number; rows: ImportRow[] } | null>(null);
const importing = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const importFile = ref<File | null>(null);

type ImportRow = {
  index: number;
  status: 'ok' | 'error';
  errors?: string[];
  student: { name: string; studentNo: string | null };
};

// --- exam form ---
const showExamForm = ref(false);
const editingExam = ref<Exam | null>(null);
const examForm = ref({
  name: '',
  subject: '',
  examType: 'unit' as Exam['examType'],
  examDate: new Date().toISOString().slice(0, 10),
  fullScore: 100,
});

const filteredStudents = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return students.value;
  return students.value.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.studentNo ?? '').toLowerCase().includes(q),
  );
});

async function loadClass() {
  const res = await api.get<Envelope<ClassItem>>(`/classes/${props.classId}`);
  cls.value = res.data;
}

async function loadStudents() {
  // Page through so classes larger than the 100-row cap still show in full.
  students.value = await fetchAllPages<Student>(`/classes/${props.classId}/students`);
}

async function loadExams() {
  const res = await api.get<Paged<Exam>>(`/classes/${props.classId}/exams`, { pageSize: 100 });
  exams.value = res.data;
}

async function loadTags() {
  const res = await api.get<Envelope<Tag[]>>('/tags');
  tags.value = res.data;
}

function openStudentCreate() {
  editingStudent.value = null;
  studentForm.value = { name: '', studentNo: '', gender: '', phone: '', qq: '', note: '', tagIds: [] };
  error.value = '';
  showStudentForm.value = true;
}

function openStudentEdit(s: Student) {
  editingStudent.value = s;
  studentForm.value = {
    name: s.name,
    studentNo: s.studentNo ?? '',
    gender: s.gender ?? '',
    phone: s.phone ?? '',
    qq: s.qq ?? '',
    note: s.note ?? '',
    tagIds: s.tags.map((t) => t.id),
  };
  error.value = '';
  showStudentForm.value = true;
}

function toggleStudentTag(tagId: string) {
  const i = studentForm.value.tagIds.indexOf(tagId);
  if (i === -1) studentForm.value.tagIds.push(tagId);
  else studentForm.value.tagIds.splice(i, 1);
}

/** Create a tag inline from the student form and select it immediately. */
async function createTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  creatingTag.value = true;
  try {
    const res = await api.post<Envelope<Tag>>('/tags', { name });
    tags.value.push(res.data);
    studentForm.value.tagIds.push(res.data.id);
    newTagName.value = '';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建标签失败';
  } finally {
    creatingTag.value = false;
  }
}

async function saveStudent() {
  error.value = '';
  try {
    const payload = {
      name: studentForm.value.name.trim(),
      studentNo: studentForm.value.studentNo.trim() || null,
      gender: studentForm.value.gender || null,
      phone: studentForm.value.phone.trim() || null,
      qq: studentForm.value.qq.trim() || null,
      note: studentForm.value.note.trim() || null,
      tagIds: studentForm.value.tagIds,
    };

    if (editingStudent.value) {
      await api.patch(`/students/${editingStudent.value.id}`, payload);
    } else {
      await api.post(`/classes/${props.classId}/students`, payload);
    }
    showStudentForm.value = false;
    await loadStudents();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function removeStudent(s: Student) {
  if (!confirm(`确定移除学生「${s.name}」吗？`)) return;
  await api.del(`/students/${s.id}`);
  await loadStudents();
}

/** Accepts "姓名" per line, or "学号,姓名" / "学号 姓名" / "学号\t姓名". */
function parseImport(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t\s]+/).filter(Boolean);
      if (parts.length >= 2 && /^\w+$/.test(parts[0])) {
        return { studentNo: parts[0], name: parts.slice(1).join('') };
      }
      return { name: parts.join(''), studentNo: null };
    });
}

async function previewImport() {
  const parsed = parseImport(importText.value);
  if (!parsed.length) return;
  importFile.value = null;
  importing.value = true;
  try {
    const res = await api.post<Envelope<typeof importPreview.value>>(
      `/classes/${props.classId}/students/bulk-import`,
      { dryRun: true, students: parsed },
    );
    importPreview.value = res.data;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '解析失败';
  } finally {
    importing.value = false;
  }
}

async function confirmImport() {
  importing.value = true;
  try {
    if (importFile.value) {
      await api.upload(`/classes/${props.classId}/students/import-file`, importFile.value, {
        dryRun: 'false',
      });
    } else {
      const parsed = parseImport(importText.value);
      await api.post(`/classes/${props.classId}/students/bulk-import`, {
        dryRun: false,
        students: parsed,
      });
    }
    showImport.value = false;
    importText.value = '';
    importFile.value = null;
    importPreview.value = null;
    await loadStudents();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '导入失败';
  } finally {
    importing.value = false;
  }
}

function downloadStudentTemplate() {
  api
    .blob(`/classes/${props.classId}/students/import-template`)
    .then((blob) => {
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${cls.value?.name ?? 'class'}-学生导入模板.xlsx`;
      a.click();
      URL.revokeObjectURL(href);
    })
    .catch(() => (error.value = '模板下载失败'));
}

function pickImportFile() {
  error.value = '';
  importFileInput.value?.click();
}

async function handleImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  importFile.value = file;
  importText.value = '';
  importing.value = true;
  error.value = '';
  try {
    const res = await api.upload<Envelope<typeof importPreview.value>>(
      `/classes/${props.classId}/students/import-file`,
      file,
      { dryRun: 'true' },
    );
    importPreview.value = res.data;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '解析失败';
    importFile.value = null;
  } finally {
    importing.value = false;
  }
}

function openExamCreate() {
  editingExam.value = null;
  examForm.value = {
    name: '',
    subject: '',
    examType: 'unit',
    examDate: new Date().toISOString().slice(0, 10),
    fullScore: 100,
  };
  error.value = '';
  showExamForm.value = true;
}

function openExamEdit(e: Exam) {
  editingExam.value = e;
  examForm.value = {
    name: e.name,
    subject: e.subject ?? '',
    examType: e.examType,
    examDate: e.examDate,
    fullScore: e.fullScore,
  };
  error.value = '';
  showExamForm.value = true;
}

async function saveExam() {
  error.value = '';
  try {
    const payload = {
      ...examForm.value,
      subject: examForm.value.subject.trim() || cls.value?.subject || null,
    };
    if (editingExam.value) {
      await api.patch(`/exams/${editingExam.value.id}`, payload);
    } else {
      await api.post(`/classes/${props.classId}/exams`, payload);
    }
    showExamForm.value = false;
    await loadExams();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function removeExam(e: Exam) {
  if (!confirm(`确定删除考试「${e.name}」吗？其成绩将一并删除。`)) return;
  await api.del(`/exams/${e.id}`);
  await loadExams();
}

function exportCsv(kind: 'scores' | 'students') {
  // The endpoint needs the bearer token, so fetch as a blob then save locally
  // rather than pointing a plain link at it. Students export as a styled .xlsx;
  // scores stay a plain .csv.
  const ext = kind === 'students' ? 'xlsx' : 'csv';
  api
    .blob(`/exports/class/${props.classId}/${kind}`)
    .then((blob) => {
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${cls.value?.name ?? 'class'}-${kind}.${ext}`;
      a.click();
      URL.revokeObjectURL(href);
    })
    .catch(() => (error.value = '导出失败'));
}

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([loadClass(), loadStudents(), loadExams(), loadTags()]);
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);
watch(() => props.classId, loadAll);
</script>

<template>
  <div class="page">
    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="cls">
      <header class="page-header">
        <div>
          <h1>
            <span class="dot" :style="{ background: cls.color }" />
            {{ cls.name }}
          </h1>
          <p class="hint">
            {{ cls.subject ?? '未设学科' }} · {{ cls.academicYear }} · {{ students.length }} 人
          </p>
        </div>
        <div class="row">
          <RouterLink
            class="btn"
            :to="{ name: 'seating', params: { classId: cls.id } }"
          >座位图</RouterLink>
          <RouterLink
            class="btn"
            :to="{ name: 'class-analytics', params: { classId: cls.id } }"
          >成绩分析</RouterLink>
        </div>
      </header>

      <nav class="tabs">
        <button :class="['tab-btn', { active: tab === 'students' }]" @click="tab = 'students'">
          学生（{{ students.length }}）
        </button>
        <button :class="['tab-btn', { active: tab === 'exams' }]" @click="tab = 'exams'">
          考试（{{ exams.length }}）
        </button>
      </nav>

      <p v-if="error" class="error-text">{{ error }}</p>

      <!-- Students tab -->
      <section v-if="tab === 'students'" class="stack">
        <div class="row">
          <input v-model="search" class="input" style="max-width: 220px" placeholder="搜索姓名或学号" />
          <div class="spacer" />
          <button class="btn" @click="exportCsv('students')">导出名册</button>
          <button
            class="btn"
            @click="
              showImport = true;
              importText = '';
              importFile = null;
              importPreview = null;
              error = '';
            "
          >
            批量导入
          </button>
          <button class="btn btn-primary" @click="openStudentCreate">+ 添加学生</button>
        </div>

        <!-- Two different situations: an empty roster needs a call to action,
             a fruitless search just needs to say so. -->
        <EmptyState
          v-if="!filteredStudents.length && students.length"
          icon="search"
          title="没有匹配的学生"
        >
          换个姓名或学号试试
        </EmptyState>

        <EmptyState
          v-else-if="!filteredStudents.length"
          icon="students"
          title="还没有学生"
        >
          可以逐个添加，或用「批量导入」一次粘贴整个名单
        </EmptyState>

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>性别</th>
                <th>标签</th>
                <th>联系电话</th>
                <th>家长QQ</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filteredStudents" :key="s.id">
                <td>{{ s.studentNo ?? '—' }}</td>
                <td>
                  <RouterLink :to="{ name: 'student-detail', params: { studentId: s.id } }">
                    {{ s.name }}
                  </RouterLink>
                </td>
                <td>{{ s.gender === 'male' ? '男' : s.gender === 'female' ? '女' : '—' }}</td>
                <td>
                  <span v-for="t in s.tags" :key="t.id" class="badge" :style="{ background: t.color + '22', color: t.color }">
                    {{ t.name }}
                  </span>
                  <span v-if="!s.tags.length">—</span>
                </td>
                <td>{{ s.phone ?? '—' }}</td>
                <td>{{ s.qq ?? '—' }}</td>
                <td>
                  <button class="btn btn-sm" @click="openStudentEdit(s)">编辑</button>
                  <button class="btn btn-sm btn-danger" @click="removeStudent(s)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Exams tab -->
      <section v-else class="stack">
        <div class="row">
          <div class="spacer" />
          <button class="btn" @click="exportCsv('scores')">导出成绩单</button>
          <button class="btn btn-primary" @click="openExamCreate">+ 新建考试</button>
        </div>

        <EmptyState v-if="!exams.length" icon="exam" title="还没有考试记录">
          新建考试后即可录入成绩并查看分析
        </EmptyState>

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>考试</th>
                <th>科目</th>
                <th>日期</th>
                <th>录入进度</th>
                <th>均分</th>
                <th>及格率</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in exams" :key="e.id">
                <td>{{ e.name }}</td>
                <td>{{ e.subject ?? '—' }}</td>
                <td>{{ e.examDate }}</td>
                <td>{{ e.entryProgress?.entered ?? 0 }} / {{ e.entryProgress?.total ?? 0 }}</td>
                <td>{{ e.stats?.avg ?? '—' }}</td>
                <td>
                  {{ e.stats?.passRate != null ? Math.round(e.stats.passRate * 100) + '%' : '—' }}
                </td>
                <td>
                  <RouterLink class="btn btn-sm" :to="{ name: 'score-entry', params: { examId: e.id } }">
                    录入
                  </RouterLink>
                  <button class="btn btn-sm" @click="openExamEdit(e)">编辑</button>
                  <button class="btn btn-sm btn-danger" @click="removeExam(e)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- Student dialog -->
    <ModalDialog
      v-if="showStudentForm"
      :title="editingStudent ? '编辑学生' : '添加学生'"
      @close="showStudentForm = false"
    >
      <!-- autocomplete="off" throughout: these fields describe a student, not
           the signed-in teacher, so browser profile autofill would silently
           overwrite real records with the device owner's own details. -->
      <form class="stack" autocomplete="off" @submit.prevent="saveStudent">
        <div class="field">
          <label for="student-name">姓名</label>
          <input
            id="student-name"
            v-model="studentForm.name"
            class="input"
            required
            autocomplete="off"
            maxlength="64"
          />
        </div>
        <div class="field">
          <label for="student-no">学号</label>
          <input
            id="student-no"
            v-model="studentForm.studentNo"
            class="input"
            placeholder="班级内唯一"
            autocomplete="off"
            maxlength="32"
          />
        </div>
        <div class="field">
          <label>性别</label>
          <select v-model="studentForm.gender" class="select">
            <option value="">未设置</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div class="field">
          <label for="student-phone">家长联系电话</label>
          <input
            id="student-phone"
            v-model="studentForm.phone"
            class="input"
            autocomplete="off"
            maxlength="32"
          />
        </div>
        <div class="field">
          <label for="student-qq">家长QQ</label>
          <input
            id="student-qq"
            v-model="studentForm.qq"
            class="input"
            autocomplete="off"
            maxlength="20"
          />
        </div>
        <div class="field">
          <label>标签</label>
          <div class="tag-picker">
            <button
              v-for="t in tags"
              :key="t.id"
              type="button"
              class="badge tag-toggle"
              :class="{ active: studentForm.tagIds.includes(t.id) }"
              :style="
                studentForm.tagIds.includes(t.id)
                  ? { background: t.color, color: '#fff' }
                  : { background: t.color + '22', color: t.color }
              "
              @click="toggleStudentTag(t.id)"
            >
              {{ t.name }}
            </button>
          </div>
          <div class="row" style="margin-top: 8px">
            <input
              v-model="newTagName"
              class="input"
              style="max-width: 160px"
              placeholder="新建标签"
              maxlength="32"
              @keydown.enter.prevent="createTag"
            />
            <button
              type="button"
              class="btn btn-sm"
              :disabled="creatingTag || !newTagName.trim()"
              @click="createTag"
            >
              添加
            </button>
          </div>
        </div>
        <div class="field">
          <label>备注</label>
          <textarea v-model="studentForm.note" class="textarea" />
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
      <template #footer>
        <button class="btn" @click="showStudentForm = false">取消</button>
        <button class="btn btn-primary" @click="saveStudent">保存</button>
      </template>
    </ModalDialog>

    <!-- Bulk import dialog -->
    <ModalDialog v-if="showImport" title="批量导入学生" wide @close="showImport = false">
      <div class="stack">
        <div class="field">
          <label>方式一：下载 Excel 模板填写后上传</label>
          <div class="row">
            <button type="button" class="btn" @click="downloadStudentTemplate">下载模板</button>
            <button type="button" class="btn" :disabled="importing" @click="pickImportFile">
              上传模板
            </button>
            <input
              ref="importFileInput"
              type="file"
              accept=".xlsx"
              style="display: none"
              @change="handleImportFileChange"
            />
            <span v-if="importFile" class="hint">已选择：{{ importFile.name }}</span>
          </div>
        </div>

        <div class="field">
          <label>方式二：粘贴文本，每行一个学生，支持「姓名」或「学号 姓名」</label>
          <textarea
            v-model="importText"
            class="textarea"
            style="min-height: 160px; font-family: monospace"
            placeholder="01 张三&#10;02 李四&#10;王五"
            @input="
              importFile = null;
              importPreview = null;
            "
          />
        </div>

        <div class="row">
          <button
            v-if="!importFile"
            class="btn"
            :disabled="importing || !importText.trim()"
            @click="previewImport"
          >
            预览校验
          </button>
          <span v-if="importPreview" class="hint">
            共 {{ importPreview.total }} 行，可导入
            <strong class="up">{{ importPreview.valid }}</strong>
            行，冲突
            <strong :class="{ down: importPreview.invalid > 0 }">{{ importPreview.invalid }}</strong>
            行
          </span>
        </div>

        <div v-if="importPreview" class="table-wrap" style="max-height: 260px; overflow-y: auto">
          <table>
            <thead>
              <tr><th>#</th><th>学号</th><th>姓名</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in importPreview.rows" :key="r.index" :class="{ bad: r.status === 'error' }">
                <td>{{ r.index + 1 }}</td>
                <td>{{ r.student.studentNo ?? '—' }}</td>
                <td>{{ r.student.name }}</td>
                <td>
                  <span v-if="r.status === 'ok'" class="up">✓ 可导入</span>
                  <span v-else class="down">{{ r.errors?.[0] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <template #footer>
        <button class="btn" @click="showImport = false">取消</button>
        <button
          class="btn btn-primary"
          :disabled="importing || !importPreview?.valid"
          @click="confirmImport"
        >
          导入 {{ importPreview?.valid ?? 0 }} 名学生
        </button>
      </template>
    </ModalDialog>

    <!-- Exam dialog -->
    <ModalDialog
      v-if="showExamForm"
      :title="editingExam ? '编辑考试' : '新建考试'"
      @close="showExamForm = false"
    >
      <form class="stack" @submit.prevent="saveExam">
        <div class="field">
          <label>考试名称</label>
          <input v-model="examForm.name" class="input" required placeholder="如：第一次月考" />
        </div>
        <div class="field">
          <label>科目</label>
          <input v-model="examForm.subject" class="input" :placeholder="cls?.subject ?? '如：数学'" />
        </div>
        <div class="field">
          <label>类型</label>
          <select v-model="examForm.examType" class="select">
            <option value="daily">平时</option>
            <option value="unit">单元</option>
            <option value="midterm">期中</option>
            <option value="final">期末</option>
          </select>
        </div>
        <div class="field">
          <label>考试日期</label>
          <input v-model="examForm.examDate" class="input" type="date" required />
        </div>
        <div class="field">
          <label>满分</label>
          <input v-model.number="examForm.fullScore" class="input" type="number" min="1" />
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
      <template #footer>
        <button class="btn" @click="showExamForm = false">取消</button>
        <button class="btn btn-primary" @click="saveExam">{{ editingExam ? '保存' : '创建' }}</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }

.tab-btn {
  padding: 9px 14px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab-btn.active { color: var(--brand); border-bottom-color: var(--brand); }

td .btn + .btn { margin-left: 6px; }
tr.bad { background: #fef2f2; }
.badge + .badge { margin-left: 4px; }

.tag-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-toggle { border: none; cursor: pointer; font: inherit; }
</style>
