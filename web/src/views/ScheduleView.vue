<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useClassStore } from '@/stores/classes';
import ModalDialog from '@/components/ModalDialog.vue';
import EventDialog from '@/components/EventDialog.vue';
import ScheduleDayColumn from '@/components/ScheduleDayColumn.vue';
import type { AgendaDay, Envelope, EventItem, ScheduleSlot } from '@/api/types';
import { instantMinutes, localIsoDate, useScheduleLayout } from '@/composables/useScheduleLayout';

const auth = useAuthStore();
const classStore = useClassStore();

const slots = ref<ScheduleSlot[]>([]);
const agenda = ref<AgendaDay | null>(null);
const weekAgenda = ref<AgendaDay[]>([]);
const loading = ref(true);
const error = ref('');

// Mobile defaults to the day view; desktop shows the full week (PRD §3.4.1).
const view = ref<'week' | 'day'>(window.innerWidth > 768 ? 'week' : 'day');
const currentDate = ref(new Date().toISOString().slice(0, 10));

// Marks today's column in the week header (see week-head-day.today below).
// A plain constant, not reactive to the clock: this label only needs to be
// right for however long the page stays open in one sitting, and re-deriving
// it on a timer would be one more moving part for a once-a-day boundary that
// a full page reload already resets — unlike the current-time line in
// ScheduleDayColumn, which visibly moves within a single sitting and does
// need the 30s tick.
const todayIso = localIsoDate(new Date());

const showForm = ref(false);
const editingSlot = ref<ScheduleSlot | null>(null);
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

// The week calendar's background blocks follow the user's day schedule
// (作息时间表): lesson blocks carry a period, activity blocks (早读/眼操/…)
// don't. Both are positioned by real time (see dayStart/dayEnd/toMinutes
// below), like a real calendar, not by row index — so a lesson, an activity,
// and a todo all share one coordinate system and never need reconciling.
const daySchedule = computed(() => auth.user?.settings.daySchedule ?? []);

// Shared time-axis math (row layout, minute→percentage, the now-line's
// position) lives in useScheduleLayout so ScheduleDayColumn — used for both
// the week grid's per-weekday columns and the day view's single wide column
// — never disagrees with this view's own time-gutter about where a given
// row/time sits. Only rowStyle is used directly here, for the gutter labels.
const { rowStyle } = useScheduleLayout(daySchedule);

/** A todo's start/end as minutes, or null for all-day / no-end-time todos
 * (which get their own fixed strip instead of a calendar block). */
function todoMinutes(e: EventItem): { start: number; end: number } | null {
  if (e.allDay || !e.endAt) return null;
  const start = instantMinutes(e.startAt);
  const end = instantMinutes(e.endAt);
  return end > start ? { start, end } : null;
}

async function loadSlots() {
  const res = await api.get<Envelope<ScheduleSlot[]>>('/schedule/slots');
  slots.value = res.data;
}

async function loadAgenda() {
  const res = await api.get<Envelope<AgendaDay[]>>('/schedule/agenda', { date: currentDate.value });
  agenda.value = res.data[0] ?? null;
}

/** Monday..Sunday (or Monday..Friday when weekends are hidden) around currentDate. */
const weekRange = computed(() => {
  const d = new Date(`${currentDate.value}T00:00:00Z`);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (isoDay - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
});

async function loadWeekAgenda() {
  const res = await api.get<Envelope<AgendaDay[]>>('/schedule/agenda', weekRange.value);
  weekAgenda.value = res.data;
}

/** Every todo in the current week, in day then start-time order. */
const weekEvents = computed(() =>
  weekAgenda.value.flatMap((d) => d.events.map((e) => ({ ...e, date: d.date, weekday: d.weekday }))),
);

/** All-day / no-end-time todos, shown in the fixed strip atop each day column. */
const allDayWeekEvents = computed(() => weekEvents.value.filter((e) => todoMinutes(e) === null));

/** Timed todos with an end time, one filtered list per weekday — handed
 * straight to each ScheduleDayColumn, which does its own interval packing. */
function timedEventsFor(weekday: number): EventItem[] {
  return weekEvents.value.filter((e) => e.weekday === weekday && todoMinutes(e) !== null);
}

/** Same split as allDayWeekEvents/timedEventsFor, but for the day view's
 * single date — agenda.events isn't pre-split by all-day vs timed the way
 * the week endpoint's flattened weekEvents is. */
const allDayAgendaEvents = computed(() => (agenda.value?.events ?? []).filter((e) => todoMinutes(e) === null));
const timedAgendaEvents = computed(() => (agenda.value?.events ?? []).filter((e) => todoMinutes(e) !== null));

/** The day view's ScheduleSlot list for its one weekday — same filter
 * (weekday match, no date-range/parity filter) as the week grid's per-column
 * `slots.filter(...)`, so a lesson shows up identically in both views. */
const agendaSlots = computed(() => (agenda.value ? slots.value.filter((s) => s.weekday === agenda.value!.weekday) : []));

function shiftDay(delta: number) {
  const d = new Date(`${currentDate.value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  currentDate.value = d.toISOString().slice(0, 10);
  loadAgenda();
}

function shiftWeek(delta: number) {
  const d = new Date(`${currentDate.value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  currentDate.value = d.toISOString().slice(0, 10);
  loadWeekAgenda();
}

function openCreate(weekday?: number, period?: number) {
  editingSlot.value = null;
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

function openEditSlot(s: ScheduleSlot) {
  editingSlot.value = s;
  form.value = {
    classId: s.classId ?? '',
    subject: s.subject ?? '',
    weekday: s.weekday,
    period: s.period,
    location: s.location ?? '',
    repeatRule: s.repeatRule,
    startDate: s.startDate ?? '',
    endDate: s.endDate ?? '',
  };
  error.value = '';
  showForm.value = true;
}

async function saveSlot() {
  error.value = '';
  const payload = {
    classId: form.value.classId || null,
    subject: form.value.subject.trim() || null,
    weekday: form.value.weekday,
    period: form.value.period,
    location: form.value.location.trim() || null,
    repeatRule: form.value.repeatRule,
    startDate: form.value.startDate || null,
    endDate: form.value.endDate || null,
  };
  try {
    if (editingSlot.value) {
      await api.patch(`/schedule/slots/${editingSlot.value.id}`, payload);
    } else {
      await api.post('/schedule/slots', payload);
    }
    showForm.value = false;
    await loadSlots();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function removeSlot(id: string) {
  if (!confirm('确定删除这节课吗？')) return;
  await api.del(`/schedule/slots/${id}`);
  showForm.value = false;
  await loadSlots();
}

// --- todos ---
const showEventDialog = ref(false);
const editingEvent = ref<EventItem | null>(null);
const createEventDate = ref(currentDate.value);

function openCreateEvent(date?: string) {
  editingEvent.value = null;
  createEventDate.value = date ?? currentDate.value;
  showEventDialog.value = true;
}

function openEditEvent(e: EventItem) {
  editingEvent.value = e;
  showEventDialog.value = true;
}

/**
 * Toggles a todo's completion. A recurring event's occurrences are
 * independent (each week has its own completion), so those go through the
 * per-occurrence endpoint keyed by date; a plain one-off event still uses
 * the event's own isDone. Only the matching (id, occurrenceDate) pair in the
 * local cache is updated — not every day this event id appears on — so
 * ticking one Wednesday never flips another week's box in the UI before the
 * next reload.
 */
async function toggleEvent(e: EventItem, isDone: boolean) {
  if (e.repeatWeekday != null && e.occurrenceDate) {
    await api.patch(`/events/${e.id}/occurrences/${e.occurrenceDate}`, { isDone });
  } else {
    await api.patch(`/events/${e.id}`, { isDone });
  }

  const matches = (x: EventItem) => x.id === e.id && x.occurrenceDate === e.occurrenceDate;
  const ev = agenda.value?.events.find(matches);
  if (ev) ev.isDone = isDone;
  for (const d of weekAgenda.value) {
    const we = d.events.find(matches);
    if (we) we.isDone = isDone;
  }
}

/** Reloads whichever agenda(s) the current view needs. */
async function reloadAgenda() {
  await Promise.all([loadAgenda(), loadWeekAgenda()]);
}

/** "09:00" for a timed todo, "全天" for an all-day one, plus an end marker if set. */
function eventTimeLabel(e: EventItem): string {
  if (e.allDay) return '全天';
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = new Date(e.startAt);
  const startLabel = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!e.endAt) return startLabel;
  const end = new Date(e.endAt);
  const endLabel = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${startLabel}–${endLabel}`;
}

onMounted(async () => {
  try {
    await Promise.all([loadSlots(), loadAgenda(), loadWeekAgenda(), classStore.ensureLoaded()]);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page" :class="{ 'page-week': !loading }">
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
    <div v-else-if="view === 'week'" class="week-wrap">
      <div class="week-nav">
        <button class="btn btn-sm" @click="shiftWeek(-1)">‹ 上一周</button>
        <span class="hint">{{ weekRange.from }} ~ {{ weekRange.to }}</span>
        <button class="btn btn-sm" @click="shiftWeek(1)">下一周 ›</button>
      </div>

      <!-- .week-frame holds the fixed headers (weekday+date, all-day todos)
           and the scrollable time-axis calendar as one visually seamless
           block; .week-wrap's own gap only separates the nav row above it. -->
      <div class="week-frame">
        <!-- Header row: period-column label, weekday+date, and the all-day
             todo strip. A plain flex row, not part of the calendar below —
             the calendar positions everything by minute, and
             all-day/no-end-time todos have no minute range to position by. -->
        <div class="week-head">
          <div class="time-gutter-head" />
          <div
            v-for="d in visibleDays"
            :key="d"
            class="week-head-day"
            :class="{ today: weekAgenda.find((a) => a.weekday === d)?.date === todayIso }"
          >
            <div class="week-head-weekday">
              {{ WEEKDAYS[d - 1] }}
              <span v-if="weekAgenda.find((a) => a.weekday === d)?.date === todayIso" class="today-badge">今天</span>
            </div>
            <div class="week-head-date">{{ weekAgenda.find((a) => a.weekday === d)?.date.slice(5) ?? '' }}</div>
          </div>
        </div>
        <div class="week-head week-head-todos">
          <div class="time-gutter-head todo-row-label">
            <span>全天待办</span>
            <button class="todo-add-header" title="新增待办" @click="openCreateEvent(currentDate)">+</button>
          </div>
          <div v-for="d in visibleDays" :key="d" class="todo-cell">
            <div
              v-for="e in allDayWeekEvents.filter((e) => e.weekday === d)"
              :key="e.id"
              class="todo-chip"
              :class="{ done: e.isDone }"
              :title="`${eventTimeLabel(e)} · ${e.title}`"
              @click="openEditEvent(e)"
            >
              <input
                type="checkbox"
                :checked="e.isDone"
                @click.stop
                @change="toggleEvent(e, ($event.target as HTMLInputElement).checked)"
              />
              <span class="todo-chip-text">{{ e.title }}</span>
              <span v-if="e.repeatWeekday != null" class="badge">每周</span>
            </div>
            <button class="todo-add" title="新增待办" @click="openCreateEvent(weekAgenda.find((a) => a.weekday === d)?.date)">
              +
            </button>
          </div>
        </div>

        <!-- The calendar body: a real time axis, not a table. Every block
             (lesson, activity, todo) is positioned by percentage of
             dayBounds — computed once in script — so they all share one
             coordinate system and can never disagree about where "9:00" is. -->
        <div class="week-body">
        <!-- Time gutter: one label per day-schedule block, positioned the
             same way as the blocks themselves so they line up. -->
        <div class="time-gutter">
          <div
            v-for="(row, ri) in daySchedule"
            :key="ri"
            class="time-gutter-label time-gutter-label-stacked"
            :title="`${row.label} ${row.start}–${row.end}`"
            :style="rowStyle(ri)"
          >
            <strong>{{ row.label }}</strong>
            <span class="time-gutter-time">{{ row.start }}–{{ row.end }}</span>
          </div>
        </div>

        <div v-for="d in visibleDays" :key="d" class="week-day-col">
          <ScheduleDayColumn
            :weekday="d"
            :date="weekAgenda.find((a) => a.weekday === d)?.date ?? ''"
            :day-schedule="daySchedule"
            :slots="slots.filter((s) => s.weekday === d)"
            :timed-events="timedEventsFor(d)"
            @create-lesson="(period) => openCreate(d, period)"
            @edit-slot="openEditSlot"
            @remove-slot="removeSlot"
            @edit-event="openEditEvent"
            @toggle-event="toggleEvent"
          />
        </div>
        </div>
      </div>
    </div>

    <!-- Day view: same time-axis layout as the week grid (one
         ScheduleDayColumn, just wider), so a lesson/todo and the
         current-time line sit at an identical position in either view. -->
    <div v-else-if="view === 'day'" class="week-wrap">
      <div class="day-nav">
        <button class="btn btn-sm" @click="shiftDay(-1)">‹ 前一天</button>
        <input v-model="currentDate" class="input" type="date" style="width: auto" @change="loadAgenda" />
        <button class="btn btn-sm" @click="shiftDay(1)">后一天 ›</button>
      </div>

      <div v-if="agenda" class="week-frame">
        <div class="week-head">
          <div class="time-gutter-head" />
          <div class="week-head-day" :class="{ today: agenda.date === todayIso }">
            <div class="week-head-weekday">
              {{ WEEKDAYS[agenda.weekday - 1] }}
              <span v-if="agenda.date === todayIso" class="today-badge">今天</span>
            </div>
            <div class="week-head-date">
              {{ agenda.date.slice(5) }} · {{ agenda.weekParity === 'odd' ? '单周' : '双周' }}
            </div>
          </div>
        </div>
        <div class="week-head week-head-todos">
          <div class="time-gutter-head todo-row-label">
            <span>全天待办</span>
            <button class="todo-add-header" title="新增待办" @click="openCreateEvent(currentDate)">+</button>
          </div>
          <div class="todo-cell">
            <div
              v-for="e in allDayAgendaEvents"
              :key="e.id"
              class="todo-chip"
              :class="{ done: e.isDone }"
              :title="`${eventTimeLabel(e)} · ${e.title}`"
              @click="openEditEvent(e)"
            >
              <input
                type="checkbox"
                :checked="e.isDone"
                @click.stop
                @change="toggleEvent(e, ($event.target as HTMLInputElement).checked)"
              />
              <span class="todo-chip-text">{{ e.title }}</span>
              <span v-if="e.repeatWeekday != null" class="badge">每周</span>
            </div>
            <button class="todo-add" title="新增待办" @click="openCreateEvent(currentDate)">+</button>
          </div>
        </div>

        <div class="week-body">
          <div class="time-gutter">
            <div
              v-for="(row, ri) in daySchedule"
              :key="ri"
              class="time-gutter-label time-gutter-label-stacked"
              :title="`${row.label} ${row.start}–${row.end}`"
              :style="rowStyle(ri)"
            >
              <strong>{{ row.label }}</strong>
              <span class="time-gutter-time">{{ row.start }}–{{ row.end }}</span>
            </div>
          </div>

          <div class="week-day-col day-col-wide">
            <ScheduleDayColumn
              :weekday="agenda.weekday"
              :date="agenda.date"
              :day-schedule="daySchedule"
              :slots="agendaSlots"
              :timed-events="timedAgendaEvents"
              @create-lesson="(period) => openCreate(agenda!.weekday, period)"
              @edit-slot="openEditSlot"
              @remove-slot="removeSlot"
              @edit-event="openEditEvent"
              @toggle-event="toggleEvent"
            />
          </div>
        </div>
      </div>
    </div>

    <ModalDialog v-if="showForm" :title="editingSlot ? '编辑课程' : '添加课程'" @close="showForm = false">
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
        <button v-if="editingSlot" class="btn btn-danger" @click="removeSlot(editingSlot.id)">删除</button>
        <div class="spacer" />
        <button class="btn" @click="showForm = false">取消</button>
        <button class="btn btn-primary" @click="saveSlot">保存</button>
      </template>
    </ModalDialog>

    <EventDialog
      v-if="showEventDialog"
      :event="editingEvent"
      :default-date="createEventDate"
      @close="showEventDialog = false"
      @saved="reloadAgenda"
    />
  </div>
</template>

<style scoped>
/* Desktop: both the week grid and the day view (a single wide column of the
   same .week-frame layout) fill the viewport below the page header and let
   the calendar itself absorb any leftover/overflow height, so neither view
   needs to scroll the page — only the calendar body scrolls internally, and
   only if the user's day schedule spans more than fits (e.g. a custom
   40-row schedule). Mobile drops this (see the media query below) — a phone
   screen is too short for a whole calendar to ever fit, so the page just
   scrolls normally instead of fighting for a one-screen fit. */
.page-week {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-bottom: 12px;
}

.week-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

/* !important throughout: Vite's build can reorder this media query ahead of
   the desktop rules above in the emitted stylesheet (observed via
   devtools — source order here is not what ships), so relying on
   cascade-by-source-order silently loses this block on mobile. */
@media (max-width: 768px) {
  .page-week { height: auto !important; }
  .week-wrap { flex: none !important; }
  .week-frame { flex: none !important; height: 70vh !important; min-height: 420px !important; }
  .week-head-date { display: block !important; }
  .todo-chip-text { max-width: 60px !important; }
}

.week-nav { display: flex; align-items: center; justify-content: center; gap: 10px; }

.switcher { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.switcher button { border: none; background: var(--surface); padding: 7px 13px; color: var(--text-muted); }
.switcher button.active { background: var(--brand); color: #fff; }

/* Wraps the two fixed header rows and the scrollable calendar so they read
   as one seamless block, with .week-wrap's own gap only separating the nav
   row above from this frame. */
.week-frame {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* Header rows: weekday+date, and the all-day todo strip. Plain flex rows —
   not part of the time-axis calendar below, since all-day/no-end-time todos
   have no minute range to position by. */
.week-head {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}

.time-gutter-head { width: 84px; flex-shrink: 0; }

.week-head-day {
  flex: 1;
  padding: 6px 8px;
  font-weight: 600;
  text-align: center;
  border-left: 1px solid var(--border);
}

.week-head-day.today { background: var(--brand-soft); }
.week-head-day.today .week-head-weekday { color: var(--brand-dark); }

.today-badge {
  display: inline-block;
  margin-left: 3px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
}

.week-head-date {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-muted);
}

.week-head-todos { background: #fffdf5; }

.todo-row-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  padding: 4px;
}

.todo-add-header {
  border: none;
  background: var(--brand-soft, #eef2ff);
  color: var(--brand);
  border-radius: 4px;
  width: 16px;
  height: 16px;
  line-height: 1;
  cursor: pointer;
  font-size: 12px;
}

.todo-cell {
  flex: 1;
  padding: 4px 6px;
  min-width: 0;
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

/* The calendar body: a real time axis. .week-body is the flex row of gutter
   + day columns; every block inside a day column is positioned by
   `top`/`height` percentages of dayBounds (computed in script from
   toMinutes()), so a lesson, an activity backdrop, and a todo all share one
   coordinate system — no row index or grid line to keep in sync. */
.week-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--surface);
}

.time-gutter { position: relative; width: 84px; flex-shrink: 0; }

/* Every day-schedule row shows label and time-range stacked on their own
   line, like a normal timetable — MIN_ROW_SHARE (script) gives even a 5-min
   block like 眼操 enough height for two lines, so no row needs to fall back
   to a cramped single-line layout. */
.time-gutter-label {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 3px;
  background: #f8fafc;
  border-top: 1px solid var(--border);
  padding: 1px 2px;
  font-size: 10px;
  line-height: 1.2;
  overflow: hidden;
  white-space: nowrap;
}

.time-gutter-label-stacked {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  white-space: normal;
}

.time-gutter-time { font-size: 9px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }

.week-day-col {
  position: relative;
  flex: 1;
  border-left: 1px solid var(--border);
}

/* Day view reuses the week grid's single-column frame at full width instead
   of splitting into 5-7 narrow columns. */
.day-col-wide { flex: 1; }

.todo-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

.todo-chip:hover { background: var(--hover-tint, #f1f5f9); }
.todo-chip input[type='checkbox'] { width: 12px; height: 12px; flex-shrink: 0; }
.todo-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-chip.done .todo-chip-text { color: var(--text-faint); text-decoration: line-through; }

.todo-add {
  border: none;
  background: none;
  color: var(--text-faint);
  font-size: 12px;
  cursor: pointer;
  width: 100%;
  text-align: center;
}
.todo-add:hover { color: var(--brand); }

.day-nav { display: flex; align-items: center; gap: 10px; justify-content: center; }

.badge { font-size: 10px; padding: 1px 5px; }
</style>
