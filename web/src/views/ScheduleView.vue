<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useClassStore } from '@/stores/classes';
import ModalDialog from '@/components/ModalDialog.vue';
import EventDialog from '@/components/EventDialog.vue';
import type { AgendaDay, Envelope, EventItem, ScheduleSlot } from '@/api/types';

const auth = useAuthStore();
const classStore = useClassStore();

const slots = ref<ScheduleSlot[]>([]);
const agenda = ref<AgendaDay | null>(null);
const loading = ref(true);
const error = ref('');

// Mobile defaults to the day view; desktop shows the full week (PRD §3.4.1).
const view = ref<'week' | 'day'>(window.innerWidth > 768 ? 'week' : 'day');
const currentDate = ref(new Date().toISOString().slice(0, 10));

const showForm = ref(false);
const form = ref({
  classId: '',
  subject: '',
  weekday: 1,
  period: 1,
  location: '',
  repeatRule: 'weekly' as ScheduleSlot['repeatRule'],
  startDate: '',
  endDate: '',
});

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const periodsPerDay = computed(() => auth.user?.settings.periodsPerDay ?? 8);
const showWeekend = computed(() => auth.user?.settings.showWeekend ?? false);
const visibleDays = computed(() => (showWeekend.value ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]));
const periods = computed(() => Array.from({ length: periodsPerDay.value }, (_, i) => i + 1));

/** weekly always shows; odd/even both render in the grid, labelled. */
const slotAt = (weekday: number, period: number) =>
  slots.value.filter((s) => s.weekday === weekday && s.period === period);

const periodTime = (period: number) => auth.user?.settings.periodTimes?.[period - 1] ?? null;

async function loadSlots() {
  const res = await api.get<Envelope<ScheduleSlot[]>>('/schedule/slots');
  slots.value = res.data;
}

async function loadAgenda() {
  const res = await api.get<Envelope<AgendaDay[]>>('/schedule/agenda', { date: currentDate.value });
  agenda.value = res.data[0] ?? null;
}

function shiftDay(delta: number) {
  const d = new Date(`${currentDate.value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  currentDate.value = d.toISOString().slice(0, 10);
  loadAgenda();
}

function openCreate(weekday?: number, period?: number) {
  form.value = {
    classId: classStore.items[0]?.id ?? '',
    subject: '',
    weekday: weekday ?? 1,
    period: period ?? 1,
    location: '',
    repeatRule: 'weekly',
    startDate: '',
    endDate: '',
  };
  error.value = '';
  showForm.value = true;
}

async function saveSlot() {
  error.value = '';
  try {
    await api.post('/schedule/slots', {
      classId: form.value.classId || null,
      subject: form.value.subject.trim() || null,
      weekday: form.value.weekday,
      period: form.value.period,
      location: form.value.location.trim() || null,
      repeatRule: form.value.repeatRule,
      startDate: form.value.startDate || null,
      endDate: form.value.endDate || null,
    });
    showForm.value = false;
    await loadSlots();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function removeSlot(id: string) {
  if (!confirm('确定删除这节课吗？')) return;
  await api.del(`/schedule/slots/${id}`);
  await loadSlots();
}

const ruleLabel = (r: string) =>
  r === 'odd_week' ? '单周' : r === 'even_week' ? '双周' : '';

// --- todos ---
const showEventDialog = ref(false);
const editingEvent = ref<EventItem | null>(null);

function openCreateEvent() {
  editingEvent.value = null;
  showEventDialog.value = true;
}

function openEditEvent(e: EventItem) {
  editingEvent.value = e;
  showEventDialog.value = true;
}

async function toggleEvent(id: string, isDone: boolean) {
  await api.patch(`/events/${id}`, { isDone });
  const ev = agenda.value?.events.find((e) => e.id === id);
  if (ev) ev.isDone = isDone;
}

onMounted(async () => {
  try {
    await Promise.all([loadSlots(), loadAgenda(), classStore.ensureLoaded()]);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>日程表</h1>
      <div class="row">
        <div class="switcher">
          <button :class="{ active: view === 'week' }" @click="view = 'week'">周视图</button>
          <button :class="{ active: view === 'day' }" @click="view = 'day'">日视图</button>
        </div>
        <button class="btn btn-primary" @click="openCreate()">+ 添加课程</button>
      </div>
    </header>

    <p v-if="error" class="error-text">{{ error }}</p>
    <div v-if="loading" class="empty">加载中…</div>

    <!-- Week grid -->
    <div v-else-if="view === 'week'" class="table-wrap">
      <table class="week">
        <thead>
          <tr>
            <th style="width: 84px">节次</th>
            <th v-for="d in visibleDays" :key="d">{{ WEEKDAYS[d - 1] }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in periods" :key="p">
            <td class="period-cell">
              <strong>第{{ p }}节</strong>
              <div v-if="periodTime(p)" class="hint">{{ periodTime(p)![0] }}</div>
            </td>
            <td v-for="d in visibleDays" :key="d" class="slot-cell" @click="!slotAt(d, p).length && openCreate(d, p)">
              <div
                v-for="s in slotAt(d, p)"
                :key="s.id"
                class="slot"
                :style="{ borderLeftColor: s.classColor ?? 'var(--brand)' }"
              >
                <div class="slot-subject">
                  {{ s.subject ?? '课程' }}
                  <span v-if="ruleLabel(s.repeatRule)" class="badge">{{ ruleLabel(s.repeatRule) }}</span>
                </div>
                <div class="hint">{{ s.className ?? '—' }}</div>
                <div v-if="s.location" class="hint">{{ s.location }}</div>
                <button class="del" @click.stop="removeSlot(s.id)">×</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Day view -->
    <div v-else class="stack">
      <div class="day-nav">
        <button class="btn btn-sm" @click="shiftDay(-1)">‹ 前一天</button>
        <input v-model="currentDate" class="input" type="date" style="width: auto" @change="loadAgenda" />
        <button class="btn btn-sm" @click="shiftDay(1)">后一天 ›</button>
      </div>

      <div v-if="agenda" class="stack">
        <p class="hint">
          {{ WEEKDAYS[agenda.weekday - 1] }} ·
          {{ agenda.weekParity === 'odd' ? '单周' : '双周' }}
        </p>

        <section class="card">
          <div class="card-title">课程（{{ agenda.lessons.length }}）</div>
          <p v-if="!agenda.lessons.length" class="empty-inline">这一天没有排课</p>
          <div v-for="l in agenda.lessons" :key="l.slotId" class="lesson">
            <span class="bar" :style="{ background: l.classColor ?? 'var(--brand)' }" />
            <div style="min-width: 90px">
              <strong>第{{ l.period }}节</strong>
              <div v-if="l.startTime" class="hint">{{ l.startTime }}–{{ l.endTime }}</div>
            </div>
            <div>
              <div>{{ l.subject ?? '课程' }}</div>
              <div class="hint">{{ l.className ?? '—' }}<template v-if="l.location"> · {{ l.location }}</template></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="row" style="margin-bottom: 10px">
            <div class="card-title" style="margin: 0">待办（{{ agenda.events.length }}）</div>
            <div class="spacer" />
            <button class="btn btn-sm btn-primary" @click="openCreateEvent">+ 新增待办</button>
          </div>

          <p v-if="!agenda.events.length" class="empty-inline">这一天没有待办</p>

          <div v-for="e in agenda.events" :key="e.id" class="todo">
            <input
              type="checkbox"
              :checked="e.isDone"
              @change="toggleEvent(e.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="todo-title" :class="{ done: e.isDone }" @click="openEditEvent(e)">
              {{ e.title }}
            </span>
            <span v-if="e.className" class="badge">{{ e.className }}</span>
            <div class="spacer" />
            <button class="btn btn-sm" @click="openEditEvent(e)">编辑</button>
          </div>
        </section>
      </div>
    </div>

    <ModalDialog v-if="showForm" title="添加课程" @close="showForm = false">
      <form class="stack" @submit.prevent="saveSlot">
        <div class="field">
          <label>班级</label>
          <select v-model="form.classId" class="select">
            <option value="">不关联班级</option>
            <option v-for="c in classStore.items" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>科目</label>
          <input v-model="form.subject" class="input" placeholder="如：数学" />
        </div>
        <div class="row">
          <div class="field" style="flex: 1">
            <label>星期</label>
            <select v-model.number="form.weekday" class="select">
              <option v-for="(w, i) in WEEKDAYS" :key="i" :value="i + 1">{{ w }}</option>
            </select>
          </div>
          <div class="field" style="flex: 1">
            <label>节次</label>
            <select v-model.number="form.period" class="select">
              <option v-for="p in periods" :key="p" :value="p">第{{ p }}节</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>重复</label>
          <select v-model="form.repeatRule" class="select">
            <option value="weekly">每周</option>
            <option value="odd_week">单周</option>
            <option value="even_week">双周</option>
          </select>
        </div>
        <div class="field">
          <label>地点</label>
          <input v-model="form.location" class="input" placeholder="如：教学楼A301" />
        </div>
        <div class="row">
          <div class="field" style="flex: 1">
            <label>学期开始</label>
            <input v-model="form.startDate" class="input" type="date" />
          </div>
          <div class="field" style="flex: 1">
            <label>学期结束</label>
            <input v-model="form.endDate" class="input" type="date" />
          </div>
        </div>
        <p class="hint">单/双周以「学期开始」所在周为第 1 周（单周）计算</p>
        <p v-if="error" class="error-text">{{ error }}</p>
      </form>
      <template #footer>
        <button class="btn" @click="showForm = false">取消</button>
        <button class="btn btn-primary" @click="saveSlot">保存</button>
      </template>
    </ModalDialog>

    <EventDialog
      v-if="showEventDialog"
      :event="editingEvent"
      :default-date="currentDate"
      @close="showEventDialog = false"
      @saved="loadAgenda"
    />
  </div>
</template>

<style scoped>
.switcher { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.switcher button { border: none; background: var(--surface); padding: 7px 13px; color: var(--text-muted); }
.switcher button.active { background: var(--brand); color: #fff; }

table.week td { vertical-align: top; padding: 4px; }
.period-cell { text-align: center; background: #f8fafc; white-space: nowrap; }
.slot-cell { min-width: 120px; height: 66px; cursor: pointer; }

.slot {
  position: relative;
  background: var(--brand-soft);
  border-left: 3px solid var(--brand);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  white-space: normal;
}

.slot-subject { font-weight: 600; }

.del {
  position: absolute;
  top: 2px;
  right: 4px;
  border: none;
  background: none;
  color: var(--text-faint);
  display: none;
  font-size: 14px;
}

.slot:hover .del { display: block; }

.day-nav { display: flex; align-items: center; gap: 10px; justify-content: center; }

.lesson { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.bar { width: 4px; height: 34px; border-radius: 2px; }
.todo { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.todo-title { cursor: pointer; }
.todo-title:hover { color: var(--brand); }
.todo .done { color: var(--text-faint); text-decoration: line-through; }
.badge { font-size: 10px; padding: 1px 5px; }
</style>
