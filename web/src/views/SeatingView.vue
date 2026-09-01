<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import ModalDialog from '@/components/ModalDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Envelope, SeatingChartDetail, SeatingChartSummary } from '@/api/types';

const props = defineProps<{ classId: string }>();

const charts = ref<SeatingChartSummary[]>([]);
const chart = ref<SeatingChartDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const message = ref('');

const showCreate = ref(false);
const createForm = ref({
  name: '日常版',
  rowCount: 6,
  colCount: 8,
  podium: 'top' as 'top' | 'bottom',
  // Comma-separated column-group sizes for aisle gaps, e.g. "2,4,2". Kept as
  // free text in the form (not parsed until submit) so a teacher can type
  // digits and commas naturally; empty means "no aisles".
  aislesInput: '',
});
const createError = ref('');

/** Parses "2,4,2" into [2,4,2], validating it sums to colCount. Empty input means no aisles. */
function parseAisleGroups(input: string, colCount: number): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const groups = trimmed.split(',').map((s) => Number(s.trim()));
  if (groups.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error('过道分组需为正整数，用逗号分隔，例如 2,4,2');
  }
  const sum = groups.reduce((a, b) => a + b, 0);
  if (sum !== colCount) {
    throw new Error(`过道分组列数之和（${sum}）必须等于总列数（${colCount}）`);
  }
  return groups;
}

const showRandomize = ref(false);
const randomOptions = ref({ keepPinned: true, avoidSameGenderAdjacent: false });

// Editing is desktop-only: dragging a 6x8 grid on a phone is error-prone,
// so mobile gets a read-only board (PRD §3.5.3).
const isDesktop = ref(window.innerWidth > 768);
window.addEventListener('resize', () => (isDesktop.value = window.innerWidth > 768));

const dragging = ref<string | null>(null);

const seatMap = computed(() => {
  const map = new Map<string, SeatingChartDetail['assignments'][number]>();
  for (const a of chart.value?.assignments ?? []) map.set(`${a.rowIndex}:${a.colIndex}`, a);
  return map;
});

const disabledSet = computed(
  () => new Set((chart.value?.layout.disabledCells ?? []).map(([r, c]) => `${r}:${c}`)),
);

const podium = computed<'top' | 'bottom'>(() => chart.value?.layout.podium ?? 'top');

// `rowIndex` in the data is always "distance from row 0"; when the podium is
// at the bottom of the room, row 0 is actually the *back* row, so the visual
// stacking order (top of the page to bottom) must reverse to put row 0 last.
const rows = computed(() => {
  const list = Array.from({ length: chart.value?.rowCount ?? 0 }, (_, i) => i);
  return podium.value === 'bottom' ? list.reverse() : list;
});
const cols = computed(() => Array.from({ length: chart.value?.colCount ?? 0 }, (_, i) => i));

// Aisle gaps: `aisles.groups` (e.g. [2,4,2]) partitions every column into
// visual clusters. `aisleAfter` is the set of column indices that get extra
// right-margin (a gap) rendered after them — the last column of every group
// except the final one.
const aisleAfter = computed(() => {
  const groups = chart.value?.layout.aisles?.groups;
  if (!groups?.length) return new Set<number>();
  const set = new Set<number>();
  let col = -1;
  for (let g = 0; g < groups.length - 1; g++) {
    col += groups[g];
    set.add(col);
  }
  return set;
});

// Grid column tracks: every seat column is an equal `minmax(64px, 1fr)`
// track; an aisle inserts a fixed-width gap track of its own instead of a
// per-cell margin, so margins don't eat into one column's box and leave
// seat cells visibly different sizes across the row.
const gridTemplateColumns = computed(() => {
  const colCount = chart.value?.colCount ?? 0;
  const tracks: string[] = [];
  for (let c = 0; c < colCount; c++) {
    tracks.push('minmax(64px, 1fr)');
    if (aisleAfter.value.has(c)) tracks.push('22px');
  }
  return tracks.join(' ');
});

async function loadCharts() {
  const res = await api.get<Envelope<SeatingChartSummary[]>>(
    `/classes/${props.classId}/seating-charts`,
  );
  charts.value = res.data;
}

async function loadChart(id: string) {
  const res = await api.get<Envelope<SeatingChartDetail>>(`/seating-charts/${id}`);
  chart.value = res.data;
}

async function createChart() {
  error.value = '';
  createError.value = '';
  const { name, rowCount, colCount, podium: podiumChoice, aislesInput } = createForm.value;

  let aisleGroups: number[] | null;
  try {
    aisleGroups = parseAisleGroups(aislesInput, colCount);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : '过道分组格式不正确';
    return;
  }

  try {
    const res = await api.post<Envelope<{ id: string }>>(
      `/classes/${props.classId}/seating-charts`,
      {
        name,
        rowCount,
        colCount,
        layout: {
          podium: podiumChoice,
          ...(aisleGroups ? { aisles: { groups: aisleGroups } } : {}),
        },
        isActive: charts.value.length === 0,
      },
    );
    showCreate.value = false;
    await loadCharts();
    await loadChart(res.data.id);
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : '创建失败';
  }
}

async function renameChart() {
  if (!chart.value) return;
  const name = window.prompt('方案名称', chart.value.name)?.trim();
  if (!name || name === chart.value.name) return;
  error.value = '';
  try {
    await api.patch(`/seating-charts/${chart.value.id}`, { name });
    chart.value.name = name;
    await loadCharts();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '重命名失败';
  }
}

async function setActiveChart() {
  if (!chart.value || chart.value.isActive) return;
  error.value = '';
  try {
    await api.patch(`/seating-charts/${chart.value.id}`, { isActive: true });
    chart.value.isActive = true;
    await loadCharts();
    message.value = '✓ 已设为使用中';
    setTimeout(() => (message.value = ''), 2500);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '设置失败';
  }
}

async function deleteChart() {
  if (!chart.value) return;
  if (!window.confirm(`确定删除「${chart.value.name}」？此操作不可恢复。`)) return;
  error.value = '';
  try {
    await api.del(`/seating-charts/${chart.value.id}`);
    chart.value = null;
    await loadCharts();
    const next = charts.value.find((c) => c.isActive) ?? charts.value[0];
    if (next) await loadChart(next.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '删除失败';
  }
}

function onDragStart(studentId: string) {
  if (!isDesktop.value) return;
  dragging.value = studentId;
}

/** Dropping on an occupied seat swaps the two students. */
function onDrop(rowIndex: number, colIndex: number) {
  if (!dragging.value || !chart.value) return;
  if (disabledSet.value.has(`${rowIndex}:${colIndex}`)) return;

  const assignments = [...chart.value.assignments];
  const movingIdx = assignments.findIndex((a) => a.studentId === dragging.value);
  const targetIdx = assignments.findIndex(
    (a) => a.rowIndex === rowIndex && a.colIndex === colIndex,
  );

  if (movingIdx === -1) {
    // Coming from the unassigned pool.
    const student = chart.value.unassignedStudents.find((s) => s.id === dragging.value);
    if (!student) return;
    if (targetIdx !== -1) {
      const displaced = assignments[targetIdx];
      assignments.splice(targetIdx, 1);
      chart.value.unassignedStudents.push({
        id: displaced.studentId,
        name: displaced.studentName ?? '',
        studentNo: displaced.studentNo,
        gender: displaced.gender,
      });
    }
    assignments.push({
      studentId: student.id,
      studentName: student.name,
      studentNo: student.studentNo,
      gender: student.gender,
      rowIndex,
      colIndex,
      isPinned: false,
    });
    chart.value.unassignedStudents = chart.value.unassignedStudents.filter(
      (s) => s.id !== student.id,
    );
  } else if (targetIdx === -1) {
    assignments[movingIdx] = { ...assignments[movingIdx], rowIndex, colIndex };
  } else {
    const from = assignments[movingIdx];
    const to = assignments[targetIdx];
    assignments[movingIdx] = { ...from, rowIndex: to.rowIndex, colIndex: to.colIndex };
    assignments[targetIdx] = { ...to, rowIndex: from.rowIndex, colIndex: from.colIndex };
  }

  chart.value.assignments = assignments;
  dragging.value = null;
}

function togglePin(studentId: string) {
  if (!chart.value) return;
  chart.value.assignments = chart.value.assignments.map((a) =>
    a.studentId === studentId ? { ...a, isPinned: !a.isPinned } : a,
  );
}

function unseat(studentId: string) {
  if (!chart.value) return;
  const a = chart.value.assignments.find((x) => x.studentId === studentId);
  if (!a) return;
  chart.value.assignments = chart.value.assignments.filter((x) => x.studentId !== studentId);
  chart.value.unassignedStudents.push({
    id: a.studentId,
    name: a.studentName ?? '',
    studentNo: a.studentNo,
    gender: a.gender,
  });
}

async function save() {
  if (!chart.value) return;
  error.value = '';
  message.value = '';
  saving.value = true;
  try {
    await api.put(`/seating-charts/${chart.value.id}/assignments`, {
      assignments: chart.value.assignments.map((a) => ({
        studentId: a.studentId,
        rowIndex: a.rowIndex,
        colIndex: a.colIndex,
        isPinned: a.isPinned,
      })),
    });
    message.value = '✓ 座位表已保存';
    setTimeout(() => (message.value = ''), 2500);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function randomize() {
  if (!chart.value) return;
  error.value = '';
  try {
    await api.post(`/seating-charts/${chart.value.id}/randomize`, {
      ...randomOptions.value,
      persist: true,
    });
    showRandomize.value = false;
    await loadChart(chart.value.id);
    message.value = '✓ 已随机排座';
    setTimeout(() => (message.value = ''), 2500);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '随机排座失败';
    showRandomize.value = false;
  }
}

function print() {
  window.print();
}

onMounted(async () => {
  try {
    await loadCharts();
    const active = charts.value.find((c) => c.isActive) ?? charts.value[0];
    if (active) await loadChart(active.id);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="page-header no-print">
      <h1>座位图</h1>
      <div class="row">
        <select
          v-if="charts.length"
          :value="chart?.id"
          class="select"
          style="width: auto"
          @change="loadChart(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="c in charts" :key="c.id" :value="c.id">
            {{ c.name }}{{ c.isActive ? '（使用中）' : '' }}
          </option>
        </select>
        <button class="btn" @click="showCreate = true">+ 新方案</button>
        <template v-if="chart && isDesktop">
          <button class="btn" title="重命名当前方案" @click="renameChart">重命名</button>
          <button
            v-if="!chart.isActive"
            class="btn"
            title="将当前方案设为使用中"
            @click="setActiveChart"
          >
            设为使用中
          </button>
          <button class="btn" title="删除当前方案" @click="deleteChart">删除</button>
          <button class="btn" @click="showRandomize = true">随机排座</button>
          <button class="btn" @click="print">打印</button>
          <button class="btn btn-primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </template>
      </div>
    </header>

    <p v-if="error" class="error-text no-print">{{ error }}</p>
    <p v-if="message" class="up no-print">{{ message }}</p>

    <div v-if="loading" class="empty">加载中…</div>

    <EmptyState v-else-if="!chart" icon="seating" title="还没有座位方案">
      点击「新方案」创建，可保存多套并标记当前使用
    </EmptyState>

    <div v-else class="seating-layout">
      <div class="board-wrap">
        <div v-if="podium === 'top'" class="podium">讲台</div>

        <div class="board" :style="{ gridTemplateColumns }">
          <template v-for="r in rows" :key="r">
            <template v-for="c in cols" :key="`${r}-${c}`">
              <div
                class="seat"
                :class="{
                  disabled: disabledSet.has(`${r}:${c}`),
                  filled: seatMap.get(`${r}:${c}`),
                  pinned: seatMap.get(`${r}:${c}`)?.isPinned,
                  male: seatMap.get(`${r}:${c}`)?.gender === 'male',
                  female: seatMap.get(`${r}:${c}`)?.gender === 'female',
                }"
                @dragover.prevent
                @drop="onDrop(r, c)"
              >
                <template v-if="seatMap.get(`${r}:${c}`)">
                  <div
                    class="seat-card"
                    :draggable="isDesktop"
                    @dragstart="onDragStart(seatMap.get(`${r}:${c}`)!.studentId)"
                  >
                    <span class="seat-name">{{ seatMap.get(`${r}:${c}`)!.studentName }}</span>
                    <span class="seat-no">{{ seatMap.get(`${r}:${c}`)!.studentNo ?? '' }}</span>
                    <div v-if="isDesktop" class="seat-actions no-print">
                      <button
                        class="mini"
                        :title="seatMap.get(`${r}:${c}`)!.isPinned ? '取消固定' : '固定座位'"
                        @click.stop="togglePin(seatMap.get(`${r}:${c}`)!.studentId)"
                      >
                        {{ seatMap.get(`${r}:${c}`)!.isPinned ? '📌' : '📍' }}
                      </button>
                      <button class="mini" title="移出座位" @click.stop="unseat(seatMap.get(`${r}:${c}`)!.studentId)">
                        ×
                      </button>
                    </div>
                  </div>
                </template>
                <span v-else-if="!disabledSet.has(`${r}:${c}`)" class="seat-empty">空位</span>
              </div>
              <div v-if="aisleAfter.has(c)" class="aisle-gap" aria-hidden="true"></div>
            </template>
          </template>
        </div>

        <div v-if="podium === 'bottom'" class="podium podium-bottom">讲台</div>
      </div>

      <aside v-if="isDesktop" class="pool no-print">
        <div class="card-title">未排座（{{ chart.unassignedStudents.length }}）</div>
        <p v-if="!chart.unassignedStudents.length" class="hint">全部学生已排座</p>
        <div
          v-for="s in chart.unassignedStudents"
          :key="s.id"
          class="pool-item"
          draggable="true"
          @dragstart="onDragStart(s.id)"
        >
          {{ s.name }}
          <span class="hint">{{ s.studentNo }}</span>
        </div>
        <p class="hint" style="margin-top: 10px">拖动学生到座位；拖到已占座位可交换</p>
      </aside>

      <p v-else class="hint no-print">手机端为只读视图，如需调整请在电脑上编辑</p>
    </div>

    <ModalDialog v-if="showCreate" title="新建座位方案" @close="showCreate = false">
      <form class="stack" @submit.prevent="createChart">
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="field">
          <label>方案名称</label>
          <input v-model="createForm.name" class="input" required />
        </div>
        <div class="field">
          <label>行数</label>
          <input v-model.number="createForm.rowCount" class="input" type="number" min="1" max="20" />
        </div>
        <div class="field">
          <label>列数</label>
          <input v-model.number="createForm.colCount" class="input" type="number" min="1" max="20" />
        </div>
        <div class="field">
          <label>讲台位置</label>
          <select v-model="createForm.podium" class="select">
            <option value="top">上方（第 1 行离讲台最近）</option>
            <option value="bottom">下方（最后一行离讲台最近）</option>
          </select>
        </div>
        <div class="field">
          <label>过道分组（可选）</label>
          <input
            v-model="createForm.aislesInput"
            class="input"
            placeholder="例如 2,4,2，留空表示不设过道"
          />
          <p class="hint">按列数分组，组之间会显示一条过道；各组列数之和需等于总列数。</p>
        </div>
      </form>
      <template #footer>
        <button class="btn" @click="showCreate = false">取消</button>
        <button class="btn btn-primary" @click="createChart">创建</button>
      </template>
    </ModalDialog>

    <ModalDialog v-if="showRandomize" title="随机排座" @close="showRandomize = false">
      <div class="stack">
        <label class="check">
          <input v-model="randomOptions.keepPinned" type="checkbox" />
          <span>保持已固定（📌）学生的座位不变</span>
        </label>
        <label class="check">
          <input v-model="randomOptions.avoidSameGenderAdjacent" type="checkbox" />
          <span>尽量避免同性别左右相邻</span>
        </label>
        <p class="hint">随机排座会立即覆盖当前座位安排。</p>
      </div>
      <template #footer>
        <button class="btn" @click="showRandomize = false">取消</button>
        <button class="btn btn-primary" @click="randomize">开始随机</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.seating-layout { display: flex; gap: 20px; align-items: flex-start; }
.board-wrap { flex: 1; overflow-x: auto; }

.podium {
  background: var(--text);
  color: #fff;
  text-align: center;
  padding: 6px;
  border-radius: var(--radius-sm);
  margin-bottom: 14px;
  font-size: 13px;
  letter-spacing: 4px;
}

.podium-bottom { margin-bottom: 0; margin-top: 14px; }

.board { display: grid; gap: 8px; min-width: min-content; }

.seat {
  aspect-ratio: 4 / 3;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  position: relative;
}

/* Aisle: a dedicated empty grid track between column groups, not a margin on
   a seat cell — so every seat column keeps the same track size regardless of
   where the aisle falls. */
.aisle-gap { background: transparent; }

.seat.disabled { background: #f1f5f9; border-style: solid; opacity: 0.5; }
.seat.filled { border-style: solid; border-color: var(--brand); background: var(--brand-soft); }
.seat.pinned { border-color: var(--warning); background: #fffbeb; }

/* Gender shown as a seat-card color cue rather than an icon/label, so it
   reads at a glance without taking up extra text space. Kept subtle enough
   to stay legible alongside .filled/.pinned's border-color overrides. */
.seat.filled.male { background: #eff6ff; }
.seat.filled.female { background: #fdf2f8; }
.seat.filled.male.pinned { background: #fffbeb; border-color: #3b82f6; }
.seat.filled.female.pinned { background: #fffbeb; border-color: #ec4899; }

.seat-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: grab;
  padding: 4px;
}

.seat-name { font-weight: 600; font-size: 13px; }
.seat-no { font-size: 11px; color: var(--text-muted); }
.seat-empty { font-size: 11px; color: var(--text-faint); }

.seat-actions { position: absolute; top: 2px; right: 2px; display: none; gap: 2px; }
.seat:hover .seat-actions { display: flex; }

.mini {
  border: none;
  background: rgb(255 255 255 / 0.9);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
  padding: 2px 4px;
}

.pool {
  width: 200px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  max-height: 70vh;
  overflow-y: auto;
}

.pool-item {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  cursor: grab;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
}

.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }

@media (max-width: 768px) {
  .seating-layout { flex-direction: column; }
  .pool { width: 100%; }
}

@media print {
  .no-print { display: none !important; }
  .seat { border-color: #64748b !important; background: #fff !important; }
}
</style>
