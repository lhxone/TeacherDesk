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
const createForm = ref({ name: '日常版', rowCount: 6, colCount: 8 });

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

const rows = computed(() => Array.from({ length: chart.value?.rowCount ?? 0 }, (_, i) => i));
const cols = computed(() => Array.from({ length: chart.value?.colCount ?? 0 }, (_, i) => i));

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
  try {
    const res = await api.post<Envelope<{ id: string }>>(
      `/classes/${props.classId}/seating-charts`,
      { ...createForm.value, isActive: charts.value.length === 0 },
    );
    showCreate.value = false;
    await loadCharts();
    await loadChart(res.data.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '创建失败';
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
        <div class="podium">讲台</div>

        <div
          class="board"
          :style="{ gridTemplateColumns: `repeat(${chart.colCount}, minmax(64px, 1fr))` }"
        >
          <template v-for="r in rows" :key="r">
            <div
              v-for="c in cols"
              :key="`${r}-${c}`"
              class="seat"
              :class="{
                disabled: disabledSet.has(`${r}:${c}`),
                filled: seatMap.get(`${r}:${c}`),
                pinned: seatMap.get(`${r}:${c}`)?.isPinned,
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
          </template>
        </div>
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

.seat.disabled { background: #f1f5f9; border-style: solid; opacity: 0.5; }
.seat.filled { border-style: solid; border-color: var(--brand); background: var(--brand-soft); }
.seat.pinned { border-color: var(--warning); background: #fffbeb; }

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
