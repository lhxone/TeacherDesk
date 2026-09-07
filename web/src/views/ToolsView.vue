<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, fetchAllPages } from '@/api/client';
import { useClassStore } from '@/stores/classes';
import EmptyState from '@/components/EmptyState.vue';
import GgbApplet from '@/components/GgbApplet.vue';
import ScreenRecorder from '@/components/ScreenRecorder.vue';
import { resourcesApi } from '@/api/resources';
import type { Envelope, Exam, GroupResult, Paged, Resource, Student } from '@/api/types';

const classStore = useClassStore();

type Tool = 'lottery' | 'grouping' | 'geogebra';
const tool = ref<Tool>('lottery');
const classId = ref('');
const error = ref('');

// --- lottery ---
const drawCount = ref(1);
const drawMode = ref<'plain' | 'noRepeat' | 'weighted'>('noRepeat');
const drawn = ref<{ id: string; name: string; studentNo: string | null }[]>([]);
const rolling = ref(false);
const rollName = ref('');
const roundRemaining = ref<number | null>(null);
const students = ref<Student[]>([]);

// --- grouping ---
const groupMode = ref<'byGroupCount' | 'byGroupSize'>('byGroupCount');
const groupCount = ref(4);
const groupSize = ref(5);
const balanceGender = ref(false);
const balanceExamId = ref('');
const exams = ref<Exam[]>([]);
const groups = ref<GroupResult[]>([]);
const grouping = ref(false);

const selectedClass = computed(() => classStore.byId(classId.value));

async function loadClassData() {
  if (!classId.value) return;
  // The lottery pool must be the WHOLE class, so page through rather than
  // truncating at the server's 100-row cap.
  const [s, e] = await Promise.all([
    fetchAllPages<Student>(`/classes/${classId.value}/students`),
    api.get<Paged<Exam>>(`/classes/${classId.value}/exams`, { pageSize: 50 }),
  ]);
  students.value = s;
  exams.value = e.data;
  drawn.value = [];
  groups.value = [];
}

/**
 * Spin through names for ~1.5s before revealing the result — the classroom
 * ritual matters more than the milliseconds (PRD §3.6.1).
 */
async function drawLottery() {
  if (!classId.value || rolling.value) return;
  error.value = '';
  rolling.value = true;
  drawn.value = [];

  const pool = students.value;
  const spin = setInterval(() => {
    if (pool.length) rollName.value = pool[Math.floor(Math.random() * pool.length)].name;
  }, 70);

  try {
    const res = await api.post<
      Envelope<{
        students: { id: string; name: string; studentNo: string | null }[];
        roundRemaining: number;
        roundReset: boolean;
      }>
    >(`/classes/${classId.value}/lottery/draw`, {
      count: drawCount.value,
      mode: drawMode.value,
      record: true,
    });

    await new Promise((r) => setTimeout(r, 1500));
    drawn.value = res.data.students;
    roundRemaining.value = res.data.roundRemaining;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '抽签失败';
  } finally {
    clearInterval(spin);
    rolling.value = false;
    rollName.value = '';
  }
}

async function resetRound() {
  if (!classId.value) return;
  await api.post(`/classes/${classId.value}/lottery/reset`);
  roundRemaining.value = students.value.length;
  drawn.value = [];
}

async function generateGroups() {
  if (!classId.value) return;
  error.value = '';
  grouping.value = true;
  try {
    const res = await api.post<Envelope<{ groups: GroupResult[] }>>(
      `/classes/${classId.value}/grouping/generate`,
      {
        mode: groupMode.value,
        groupCount: groupMode.value === 'byGroupCount' ? groupCount.value : null,
        groupSize: groupMode.value === 'byGroupSize' ? groupSize.value : null,
        balanceGender: balanceGender.value,
        balanceByExamId: balanceExamId.value || null,
        persist: false,
      },
    );
    groups.value = res.data.groups;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '分组失败';
  } finally {
    grouping.value = false;
  }
}

async function saveGroups() {
  if (!classId.value || !groups.value.length) return;
  try {
    await api.post(`/classes/${classId.value}/grouping/generate`, {
      mode: groupMode.value,
      groupCount: groupMode.value === 'byGroupCount' ? groupCount.value : null,
      groupSize: groupMode.value === 'byGroupSize' ? groupSize.value : null,
      balanceGender: balanceGender.value,
      balanceByExamId: balanceExamId.value || null,
      persist: true,
    });
    error.value = '';
    alert('分组方案已保存');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

// --- GeoGebra ---
// Files are Resources with type: 'geogebra' — same store, upload, tagging,
// search and "最近使用" tracking as every other teaching material in 知识中心
// (see docs/API.md and resources.ts's PUT .../content, added for this "save
// after live-editing" case). This view only adds the applet-specific bits:
// opening one full-screen for classroom display/editing, and Demo recording.
const ggbFiles = ref<Resource[]>([]);
const ggbLoading = ref(false);
const ggbError = ref('');
const ggbUploading = ref(false);
const ggbFileInput = ref<HTMLInputElement | null>(null);
const ggbStageOpen = ref(false);
const activeGgbFile = ref<Resource | null>(null);
const activeGgbBase64 = ref('');
const activeGgbEditable = ref(false);
const activeGgbLoading = ref(false);
const ggbApplet = ref<InstanceType<typeof GgbApplet> | null>(null);
const ggbSaving = ref(false);

async function loadGgbFiles() {
  ggbLoading.value = true;
  ggbError.value = '';
  try {
    const res = await resourcesApi.list({ type: 'geogebra', pageSize: 100 });
    ggbFiles.value = res.data;
  } catch (e) {
    ggbError.value = e instanceof ApiError ? e.message : '加载 GeoGebra 文件失败';
  } finally {
    ggbLoading.value = false;
  }
}

async function uploadGgbFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  ggbUploading.value = true;
  ggbError.value = '';
  try {
    await resourcesApi.upload(file, { type: 'geogebra' });
    await loadGgbFiles();
  } catch (err) {
    ggbError.value = err instanceof ApiError ? err.message : '上传失败';
  } finally {
    ggbUploading.value = false;
    input.value = '';
  }
}

async function removeGgbFile(f: Resource) {
  if (!confirm(`删除「${f.title}」？此操作不可恢复`)) return;
  try {
    await resourcesApi.remove(f.id);
    ggbFiles.value = ggbFiles.value.filter((x) => x.id !== f.id);
  } catch (e) {
    ggbError.value = e instanceof ApiError ? e.message : '删除失败';
  }
}

/** Opens a file in the fullscreen stage. `editable` picks preview vs. live-edit mode. */
async function openGgbFile(f: Resource, editable: boolean) {
  activeGgbLoading.value = true;
  ggbError.value = '';
  try {
    const blob = await resourcesApi.fetchBlob(f.id);
    const base64 = await blobToBase64(blob);
    await resourcesApi.touch(f.id).catch(() => {});
    activeGgbFile.value = f;
    activeGgbBase64.value = base64;
    activeGgbEditable.value = editable;
    ggbStageOpen.value = true;
  } catch (e) {
    ggbError.value = e instanceof ApiError ? e.message : '打开文件失败';
  } finally {
    activeGgbLoading.value = false;
  }
}

function openBlankGgbCanvas() {
  activeGgbFile.value = null;
  activeGgbBase64.value = '';
  activeGgbEditable.value = true;
  ggbStageOpen.value = true;
}

function closeGgbStage() {
  ggbStageOpen.value = false;
  activeGgbFile.value = null;
  activeGgbBase64.value = '';
}

/**
 * Mid-demo switch from 展示 to 编辑, without leaving fullscreen — a teacher
 * mid-lesson realising they want to tweak the construction shouldn't have to
 * back out to the file list and reopen. GgbApplet's own watch() on the
 * `editable` prop already tears down and rebuilds the applet in edit mode, so
 * flipping this ref is the entire implementation.
 */
function switchGgbToEdit() {
  activeGgbEditable.value = true;
}

async function saveGgbEdits() {
  if (!activeGgbFile.value || !ggbApplet.value) return;
  ggbSaving.value = true;
  ggbError.value = '';
  try {
    const base64 = await ggbApplet.value.getBase64();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    await resourcesApi.saveContent(activeGgbFile.value.id, new Blob([bytes]), activeGgbFile.value.originalFilename);
    await loadGgbFiles();
    alert('已保存');
  } catch (e) {
    ggbError.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    ggbSaving.value = false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(async () => {
  await classStore.ensureLoaded();
  if (classStore.items.length) {
    classId.value = classStore.items[0].id;
    await loadClassData();
  }
  await loadGgbFiles();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>课堂工具</h1>
      <select v-model="classId" class="select" style="width: auto" @change="loadClassData">
        <option v-for="c in classStore.items" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </header>

    <nav class="tabs">
      <button :class="['tab-btn', { active: tool === 'lottery' }]" @click="tool = 'lottery'">
        🎲 随机抽签
      </button>
      <button :class="['tab-btn', { active: tool === 'grouping' }]" @click="tool = 'grouping'">
        👥 随机分组
      </button>
      <button :class="['tab-btn', { active: tool === 'geogebra' }]" @click="tool = 'geogebra'">
        📐 GeoGebra
      </button>
    </nav>

    <p v-if="error" class="error-text">{{ error }}</p>

    <EmptyState v-if="!classStore.items.length" icon="classes" title="请先创建班级">
      抽签与分组需要一个有学生的班级
    </EmptyState>

    <!-- Lottery -->
    <section v-else-if="tool === 'lottery'" class="stack">
      <div class="card lottery-stage">
        <div v-if="rolling" class="rolling">{{ rollName || '…' }}</div>
        <div v-else-if="drawn.length" class="result">
          <div v-for="s in drawn" :key="s.id" class="winner">
            <div class="winner-name">{{ s.name }}</div>
            <div class="hint">{{ s.studentNo ?? '' }}</div>
          </div>
        </div>
        <div v-else class="placeholder hint">点击下方按钮开始抽签</div>
      </div>

      <div class="card">
        <div class="row">
          <div class="field" style="width: 110px">
            <label>抽取人数</label>
            <input v-model.number="drawCount" class="input" type="number" min="1" :max="students.length || 1" />
          </div>
          <div class="field" style="width: 170px">
            <label>模式</label>
            <select v-model="drawMode" class="select">
              <option value="noRepeat">不重复（一轮内）</option>
              <option value="weighted">按权重（少抽优先）</option>
              <option value="plain">纯随机</option>
            </select>
          </div>
          <div class="spacer" />
          <button class="btn btn-primary btn-lg" :disabled="rolling || !students.length" @click="drawLottery">
            {{ rolling ? '抽取中…' : '开始抽签' }}
          </button>
        </div>

        <p class="hint" style="margin-top: 10px">
          {{ selectedClass?.name }} 共 {{ students.length }} 人
          <template v-if="drawMode === 'noRepeat' && roundRemaining !== null">
            · 本轮剩余 {{ roundRemaining }} 人
            <button class="btn btn-sm" style="margin-left: 8px" @click="resetRound">重置轮次</button>
          </template>
        </p>
      </div>
    </section>

    <!-- Grouping -->
    <section v-else-if="tool === 'grouping'" class="stack">
      <div class="card">
        <div class="row">
          <div class="field" style="width: 150px">
            <label>分组方式</label>
            <select v-model="groupMode" class="select">
              <option value="byGroupCount">指定组数</option>
              <option value="byGroupSize">指定每组人数</option>
            </select>
          </div>
          <div v-if="groupMode === 'byGroupCount'" class="field" style="width: 100px">
            <label>组数</label>
            <input
              v-model.number="groupCount"
              class="input"
              type="number"
              min="1"
              :max="students.length || 1"
            />
          </div>
          <div v-else class="field" style="width: 110px">
            <label>每组人数</label>
            <input v-model.number="groupSize" class="input" type="number" min="1" />
          </div>
          <div class="field" style="width: 200px">
            <label>按成绩均衡（可选）</label>
            <select v-model="balanceExamId" class="select">
              <option value="">不均衡</option>
              <option v-for="e in exams" :key="e.id" :value="e.id">{{ e.name }}</option>
            </select>
          </div>
        </div>

        <label class="check" style="margin-top: 10px">
          <input v-model="balanceGender" type="checkbox" />
          <span>按性别均衡分配</span>
        </label>

        <div class="row" style="margin-top: 14px">
          <button class="btn btn-primary" :disabled="grouping || !students.length" @click="generateGroups">
            {{ grouping ? '分组中…' : '生成分组' }}
          </button>
          <button v-if="groups.length" class="btn" @click="generateGroups">重新分组</button>
          <button v-if="groups.length" class="btn" @click="saveGroups">保存方案</button>
        </div>
      </div>

      <div v-if="groups.length" class="grid">
        <div v-for="g in groups" :key="g.groupIndex" class="card">
          <div class="card-title">
            {{ g.name }}
            <span class="hint">（{{ g.members.length }} 人<template v-if="g.avgScore !== null">，均分 {{ g.avgScore }}</template>）</span>
          </div>
          <div class="members">
            <span v-for="m in g.members" :key="m.id" class="member">{{ m.name }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- GeoGebra -->
    <section v-else class="stack">
      <div class="card">
        <div class="row">
          <button class="btn btn-primary" :disabled="ggbUploading" @click="ggbFileInput?.click()">
            {{ ggbUploading ? '上传中…' : '📤 上传 .ggb 文件' }}
          </button>
          <button class="btn" @click="openBlankGgbCanvas">✏️ 新建空白画板</button>
          <input ref="ggbFileInput" type="file" accept=".ggb" hidden @change="uploadGgbFile" />
        </div>
        <p class="hint" style="margin-top: 8px">
          支持上传 GeoGebra 官方 .ggb 文件，课堂上可全屏展示或现场编辑演示
        </p>
      </div>

      <p v-if="ggbError" class="error-text">{{ ggbError }}</p>

      <EmptyState v-if="!ggbLoading && !ggbFiles.length" icon="classes" title="还没有 GeoGebra 课件">
        点击上方按钮上传第一个 .ggb 文件
      </EmptyState>

      <div v-else class="grid">
        <div v-for="f in ggbFiles" :key="f.id" class="card ggb-card">
          <div class="card-title">{{ f.title }}</div>
          <p class="hint">{{ f.originalFilename }} · {{ formatFileSize(f.fileSize) }}</p>
          <div class="row" style="margin-top: 10px">
            <button class="btn btn-sm" :disabled="activeGgbLoading" @click="openGgbFile(f, false)">👁 展示</button>
            <button class="btn btn-sm" :disabled="activeGgbLoading" @click="openGgbFile(f, true)">✏️ 编辑</button>
            <button class="btn btn-sm btn-danger" @click="removeGgbFile(f)">删除</button>
          </div>
        </div>
      </div>
    </section>
  </div>

  <!-- Fullscreen GeoGebra stage: classroom display / live editing -->
  <div v-if="ggbStageOpen" class="ggb-stage">
    <header class="ggb-stage-head">
      <span class="ggb-stage-title">{{ activeGgbFile?.title ?? '空白画板' }}</span>
      <div class="row">
        <button v-if="!activeGgbEditable && activeGgbFile" class="btn btn-sm" @click="switchGgbToEdit">
          ✏️ 切换到编辑
        </button>
        <button v-if="activeGgbEditable && activeGgbFile" class="btn btn-sm" :disabled="ggbSaving" @click="saveGgbEdits">
          {{ ggbSaving ? '保存中…' : '💾 保存' }}
        </button>
        <button class="btn btn-sm" @click="closeGgbStage">✕ 退出全屏</button>
      </div>
    </header>
    <div class="ggb-stage-body">
      <GgbApplet
        ref="ggbApplet"
        :base64="activeGgbBase64"
        :editable="activeGgbEditable"
        height="100%"
      />
    </div>
    <div class="ggb-stage-record">
      <ScreenRecorder />
    </div>
  </div>
</template>

<style scoped>
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

.lottery-stage {
  min-height: 190px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, #eff6ff, #ffffff);
}

.rolling {
  font-size: 42px;
  font-weight: 700;
  color: var(--brand);
  opacity: 0.65;
}

.result { display: flex; gap: 26px; flex-wrap: wrap; justify-content: center; }
.winner { text-align: center; animation: pop 0.4s ease; }
.winner-name { font-size: 38px; font-weight: 700; color: var(--brand-dark); }
.placeholder { font-size: 15px; }

@keyframes pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.members { display: flex; flex-wrap: wrap; gap: 6px; }

.member {
  padding: 4px 10px;
  background: var(--brand-soft);
  color: var(--brand-dark);
  border-radius: 999px;
  font-size: 13px;
}

.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }

.ggb-card { display: flex; flex-direction: column; }

.ggb-stage {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--surface);
  display: flex;
  flex-direction: column;
}

.ggb-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}

.ggb-stage-title { font-weight: 600; }

.ggb-stage-body { flex: 1; min-height: 0; padding: 8px; }

.ggb-stage-record {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}
</style>
