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
const weekAgenda = ref<AgendaDay[]>([]);
const loading = ref(true);
const error = ref('');

// Mobile defaults to the day view; desktop shows the full week (PRD §3.4.1).
const view = ref<'week' | 'day'>(window.innerWidth > 768 ? 'week' : 'day');
const currentDate = ref(new Date().toISOString().slice(0, 10));

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

/** "HH:MM" -> minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight for an ISO instant. */
function instantMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** The calendar's visible time range: the day schedule's earliest start to
 * its latest end, padded 15 min each side so edge blocks aren't flush
 * against the top/bottom. Falls back to 07:00–18:00 with no day schedule. */
const dayBounds = computed(() => {
  const rows = daySchedule.value;
  if (!rows.length) return { start: 7 * 60, end: 18 * 60 };
  const starts = rows.map((r) => toMinutes(r.start));
  const ends = rows.map((r) => toMinutes(r.end));
  return { start: Math.max(0, Math.min(...starts) - 15), end: Math.min(24 * 60, Math.max(...ends) + 15) };
});

// A pure minute→percentage mapping squashes short blocks (眼操, 5 min) to a
// couple of px — too little to read their label. Instead each day-schedule
// row gets a minimum share of the calendar's height (MIN_ROW_SHARE, as a
// fraction of an "average" row) before the remaining height is divided by
// actual minutes, then those per-row shares are turned into cumulative
// top/height percentages — like sizing CSS grid rows with `minmax()`, but
// computed here so the result is still a plain top/height percentage that
// works with the rest of the absolute-positioning overlay (lessons, todos).
const MIN_ROW_SHARE = 0.85; // as a fraction of the day's average per-row minutes

const rowLayout = computed(() => {
  const rows = daySchedule.value;
  const { start: dayStart, end: dayEnd } = dayBounds.value;
  const totalMinutes = dayEnd - dayStart;
  if (!rows.length || totalMinutes <= 0) return { rows: [] as { top: number; height: number }[], totalShare: 1 };

  const avgMinutes = totalMinutes / rows.length;
  const minShare = avgMinutes * MIN_ROW_SHARE;
  const shares = rows.map((r) => Math.max(toMinutes(r.end) - toMinutes(r.start), minShare));
  const totalShare = shares.reduce((a, b) => a + b, 0);

  let cursor = 0;
  const laidOut = shares.map((share) => {
    const top = cursor;
    cursor += share;
    return { top, height: share };
  });
  return { rows: laidOut, totalShare };
});

/** Percentage position/height within the calendar for the Nth day-schedule row. */
function rowStyle(rowIndex: number): { top: string; height: string } {
  const { rows, totalShare } = rowLayout.value;
  const r = rows[rowIndex];
  if (!r || totalShare <= 0) return { top: '0%', height: '0%' };
  return { top: `${(r.top / totalShare) * 100}%`, height: `${(r.height / totalShare) * 100}%` };
}

/** Percentage position/height for an arbitrary minute range (a todo's
 * start–end), interpolated across whichever day-schedule rows it overlaps —
 * so a todo spanning a short row still lines up with that row's
 * minimum-share height instead of the raw minute proportion. */
function timeRangeStyle(startMin: number, endMin: number): { top: string; height: string } {
  const rows = daySchedule.value;
  const { rows: laidOut, totalShare } = rowLayout.value;
  if (!rows.length || totalShare <= 0) return { top: '0%', height: '0%' };

  // Interpolates a minute value to a cumulative-share position by locating
  // which row it falls in and blending linearly within that row's share.
  const toShare = (min: number): number => {
    for (let i = 0; i < rows.length; i++) {
      const rowStart = toMinutes(rows[i].start);
      const rowEnd = toMinutes(rows[i].end);
      if (min <= rowEnd || i === rows.length - 1) {
        const span = Math.max(rowEnd - rowStart, 1);
        const frac = Math.min(Math.max((min - rowStart) / span, 0), 1);
        return laidOut[i].top + frac * laidOut[i].height;
      }
    }
    return laidOut[laidOut.length - 1].top + laidOut[laidOut.length - 1].height;
  };

  const top = toShare(startMin);
  const bottom = toShare(endMin);
  return { top: `${(top / totalShare) * 100}%`, height: `${(Math.max(bottom - top, 0) / totalShare) * 100}%` };
}

/** A todo's start/end as minutes, or null for all-day / no-end-time todos
 * (which get their own fixed strip instead of a calendar block). */
function todoMinutes(e: EventItem): { start: number; end: number } | null {
  if (e.allDay || !e.endAt) return null;
  const start = instantMinutes(e.startAt);
  const end = instantMinutes(e.endAt);
  return end > start ? { start, end } : null;
}

/** weekly always shows; odd/even both render in the grid, labelled. */
const slotAt = (weekday: number, period: number) =>
  slots.value.filter((s) => s.weekday === weekday && s.period === period);

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

/** Timed todos with an end time, positioned on the calendar by minute. */
const timedWeekEvents = computed(() =>
  weekEvents.value
    .map((e) => ({ event: e, range: todoMinutes(e) }))
    .filter((x): x is { event: (typeof weekEvents.value)[number]; range: { start: number; end: number } } =>
      x.range !== null,
    ),
);

type LaidOutBlock = { key: string; left: number; width: number };

/**
 * Assigns each block in one day column a left/width fraction so overlapping
 * blocks (a lesson and a todo at the same time, or two todos) sit side by
 * side instead of on top of each other. Classic interval-graph column
 * packing: group mutually-overlapping blocks into a cluster, give the
 * cluster's blocks one column each out of however many the cluster needs.
 */
function packColumns(blocks: { key: string; start: number; end: number }[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: LaidOutBlock[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy column assignment within the cluster: each block takes the
    // first column whose previous occupant has already ended.
    const columnEnds: number[] = [];
    const columnOf = new Map<string, number>();
    for (const b of cluster) {
      let col = columnEnds.findIndex((end) => end <= b.start);
      if (col === -1) col = columnEnds.length;
      columnEnds[col] = b.end;
      columnOf.set(b.key, col);
    }
    const columns = columnEnds.length;
    for (const b of cluster) {
      const col = columnOf.get(b.key)!;
      result.push({ key: b.key, left: (col / columns) * 100, width: (1 / columns) * 100 });
    }
    cluster = [];
  };

  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();

  return result;
}

/** Every calendar block (lesson slots + timed todos) for one weekday, laid
 * out into non-overlapping columns. Keyed so the template can look up each
 * block's position by its own id. */
const dayLayouts = computed(() => {
  const layouts = new Map<number, Map<string, LaidOutBlock>>();
  for (const d of visibleDays.value) {
    const blocks: { key: string; start: number; end: number }[] = [];
    for (const row of daySchedule.value) {
      if (row.kind !== 'lesson' || row.period == null) continue;
      for (const s of slotAt(d, row.period)) {
        blocks.push({ key: `slot-${s.id}`, start: toMinutes(row.start), end: toMinutes(row.end) });
      }
    }
    for (const { event: e, range } of timedWeekEvents.value) {
      if (e.weekday !== d) continue;
      blocks.push({ key: `todo-${e.id}`, start: range.start, end: range.end });
    }
    const packed = packColumns(blocks);
    layouts.set(d, new Map(packed.map((b) => [b.key, b])));
  }
  return layouts;
});

function blockLayout(weekday: number, key: string): LaidOutBlock {
  return dayLayouts.value.get(weekday)?.get(key) ?? { key, left: 0, width: 100 };
}

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

const ruleLabel = (r: string) =>
  r === 'odd_week' ? '单周' : r === 'even_week' ? '双周' : '';

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

async function toggleEvent(id: string, isDone: boolean) {
  await api.patch(`/events/${id}`, { isDone });
  const ev = agenda.value?.events.find((e) => e.id === id);
  if (ev) ev.isDone = isDone;
  for (const d of weekAgenda.value) {
    const we = d.events.find((e) => e.id === id);
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
  <div class="page" :class="{ 'page-week': view === 'week' && !loading }">
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
          <div v-for="d in visibleDays" :key="d" class="week-head-day">
            <div class="week-head-weekday">{{ WEEKDAYS[d - 1] }}</div>
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
                @change="toggleEvent(e.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="todo-chip-text">{{ e.title }}</span>
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
          <!-- Background blocks: activities shade the whole column width;
               lesson blocks are click targets for creating a course when
               empty, and otherwise just backdrop (the actual lesson card is
               rendered as its own positioned block below, alongside todos,
               so interval packing can place both in the same coordinate
               space). -->
          <div
            v-for="(row, ri) in daySchedule"
            :key="ri"
            class="time-bg-block"
            :class="{ 'time-bg-activity': row.kind === 'activity' }"
            :style="rowStyle(ri)"
            @click="row.kind === 'lesson' && row.period != null && !slotAt(d, row.period).length && openCreate(d, row.period)"
          />

          <!-- Lessons -->
          <template v-for="(row, ri) in daySchedule" :key="ri">
            <div v-if="row.kind === 'lesson' && row.period != null">
              <div
                v-for="s in slotAt(d, row.period)"
                :key="s.id"
                class="slot"
                :style="{
                  borderLeftColor: s.classColor ?? 'var(--brand)',
                  ...rowStyle(ri),
                  left: `${blockLayout(d, `slot-${s.id}`).left}%`,
                  width: `calc(${blockLayout(d, `slot-${s.id}`).width}% - 4px)`,
                }"
                @click="openEditSlot(s)"
              >
                <div class="slot-subject">
                  {{ s.subject ?? '课程' }}
                  <span v-if="ruleLabel(s.repeatRule)" class="badge">{{ ruleLabel(s.repeatRule) }}</span>
                </div>
                <div class="hint">{{ s.className ?? '—' }}</div>
                <div v-if="s.location" class="hint">{{ s.location }}</div>
                <button class="del" @click.stop="removeSlot(s.id)">×</button>
              </div>
            </div>
          </template>

          <!-- Timed todos, positioned by their real start–end time and
               packed into a free column alongside any overlapping lesson. -->
          <div
            v-for="{ event: e, range } in timedWeekEvents.filter((t) => t.event.weekday === d)"
            :key="e.id"
            class="todo-block"
            :class="{ done: e.isDone }"
            :style="{
              ...timeRangeStyle(range.start, range.end),
              left: `${blockLayout(d, `todo-${e.id}`).left}%`,
              width: `calc(${blockLayout(d, `todo-${e.id}`).width}% - 4px)`,
            }"
            :title="`${eventTimeLabel(e)} · ${e.title}`"
            @click="openEditEvent(e)"
          >
            <input
              type="checkbox"
              :checked="e.isDone"
              @click.stop
              @change="toggleEvent(e.id, ($event.target as HTMLInputElement).checked)"
            />
            <div class="todo-block-text">
              <div class="todo-block-title">{{ e.title }}</div>
              <div class="hint">{{ eventTimeLabel(e) }}</div>
            </div>
          </div>
        </div>
        </div>
      </div>
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
          <div class="card-title">今日作息</div>
          <p v-if="!agenda.timeline.length" class="empty-inline">这一天没有作息安排</p>
          <div
            v-for="(item, i) in agenda.timeline"
            :key="i"
            class="lesson"
            :class="{ 'lesson-activity': item.kind === 'activity' }"
          >
            <span
              class="bar"
              :style="{
                background:
                  item.kind === 'lesson' ? (item.classColor ?? 'var(--brand)') : 'var(--border-strong)',
              }"
            />
            <div style="min-width: 108px">
              <strong>{{ item.label }}</strong>
              <div class="hint">{{ item.start }}–{{ item.end }}</div>
            </div>
            <div v-if="item.kind === 'lesson'">
              <div>{{ item.subject ?? (item.slotId ? '课程' : '空堂') }}</div>
              <div v-if="item.slotId" class="hint">
                {{ item.className ?? '—' }}<template v-if="item.location"> · {{ item.location }}</template>
              </div>
            </div>
            <div v-else class="hint">课间活动</div>
          </div>
        </section>

        <section class="card">
          <div class="row" style="margin-bottom: 10px">
            <div class="card-title" style="margin: 0">待办（{{ agenda.events.length }}）</div>
            <div class="spacer" />
            <button class="btn btn-sm btn-primary" @click="openCreateEvent()">+ 新增待办</button>
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
            <span class="hint">{{ eventTimeLabel(e) }}</span>
            <span v-if="e.className" class="badge">{{ e.className }}</span>
            <div class="spacer" />
            <button class="btn btn-sm" @click="openEditEvent(e)">编辑</button>
          </div>
        </section>
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
/* Desktop: the week view fills the viewport below the page header and lets
   the calendar itself absorb any leftover/overflow height, so switching to
   周视图 shows the whole week without scrolling the page — only the
   calendar body scrolls internally, and only if the user's day schedule
   spans more than fits (e.g. a custom 40-row schedule). Mobile drops this
   (see the media query below) — a phone screen is too short for a whole
   week to ever fit, so the page just scrolls normally instead of fighting
   for a one-screen fit. */
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

.time-bg-block {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.time-bg-activity {
  background: #f1f5f9;
  cursor: default;
}

.slot {
  position: absolute;
  box-sizing: border-box;
  background: var(--brand-soft);
  border-left: 3px solid var(--brand);
  border-radius: 6px;
  padding: 3px 6px;
  margin: 1px 2px;
  font-size: 11px;
  line-height: 1.25;
  white-space: normal;
  overflow: hidden;
  cursor: pointer;
}

.slot-subject { font-weight: 600; }
.slot .hint { font-size: 10px; line-height: 1.2; }

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

/* Timed todo, positioned on the calendar at its real start–end time and
   packed into a free column (script-computed left/width) alongside any
   overlapping lesson, exactly like two overlapping events in a real
   calendar app. */
.todo-block {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  background: #fffbeb;
  border-left: 3px solid var(--warning);
  border-radius: 6px;
  padding: 3px 6px;
  margin: 1px 2px;
  font-size: 11px;
  line-height: 1.25;
  cursor: pointer;
  overflow: hidden;
  z-index: 1;
}

.todo-block input[type='checkbox'] { margin-top: 1px; flex-shrink: 0; width: 12px; height: 12px; }
.todo-block-text { min-width: 0; overflow: hidden; }
.todo-block-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-block.done .todo-block-title { color: var(--text-faint); text-decoration: line-through; }

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

.lesson { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.lesson-activity { opacity: 0.75; }
.bar { width: 4px; height: 34px; border-radius: 2px; }
.todo { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.todo-title { cursor: pointer; }
.todo-title:hover { color: var(--brand); }
.todo .done { color: var(--text-faint); text-decoration: line-through; }
.badge { font-size: 10px; padding: 1px 5px; }
</style>
