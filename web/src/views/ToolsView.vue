<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, fetchAllPages } from '@/api/client';
import { useClassStore } from '@/stores/classes';
import EmptyState from '@/components/EmptyState.vue';
import type { Envelope, Exam, GroupResult, Paged, Student } from '@/api/types';

const classStore = useClassStore();

type Tool = 'lottery' | 'grouping';
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

onMounted(async () => {
  await classStore.ensureLoaded();
  if (classStore.items.length) {
    classId.value = classStore.items[0].id;
    await loadClassData();
  }
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
    <section v-else class="stack">
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
</style>
