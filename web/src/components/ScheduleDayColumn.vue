<script setup lang="ts">
/**
 * One day's worth of the schedule calendar: day-schedule backdrop, lesson
 * slots, and timed todos, all absolutely positioned by minute via
 * useScheduleLayout — plus a current-time line when `date` is today. Used
 * both as one column of the week grid (ScheduleView's week-body, one per
 * weekday) and as the single wide column of the day view, so both views
 * share one time-axis coordinate system and the "now" line behaves
 * identically in either place.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { DayScheduleItem, EventItem, ScheduleSlot } from '@/api/types';
import { instantMinutes, localIsoDate, packColumns, toMinutes, useScheduleLayout } from '@/composables/useScheduleLayout';

const props = defineProps<{
  /** 1 = Monday … 7 = Sunday, used only to open the "add lesson" form at the right weekday. */
  weekday: number;
  /** This day's date, "YYYY-MM-DD" — compared against today to decide whether to show the now-line. */
  date: string;
  daySchedule: DayScheduleItem[];
  slots: ScheduleSlot[];
  /** Todos with a real end time only — all-day/no-end-time todos render in the caller's own fixed strip, not here. */
  timedEvents: EventItem[];
}>();

const emit = defineEmits<{
  'create-lesson': [period: number];
  'edit-slot': [slot: ScheduleSlot];
  'remove-slot': [slotId: string];
  'edit-event': [event: EventItem];
  'toggle-event': [event: EventItem, isDone: boolean];
}>();

const daySchedule = computed(() => props.daySchedule);
const { rowStyle, timeRangeStyle, timeToTop } = useScheduleLayout(daySchedule);

function todoMinutes(e: EventItem): { start: number; end: number } | null {
  if (e.allDay || !e.endAt) return null;
  const start = instantMinutes(e.startAt);
  const end = instantMinutes(e.endAt);
  return end > start ? { start, end } : null;
}

const slotAt = (period: number) => props.slots.filter((s) => s.period === period);

/** Lessons + timed todos packed into non-overlapping columns so two
 * overlapping blocks sit side by side instead of on top of each other. */
const layout = computed(() => {
  const blocks: { key: string; start: number; end: number }[] = [];
  for (const row of props.daySchedule) {
    if (row.kind !== 'lesson' || row.period == null) continue;
    for (const s of slotAt(row.period)) {
      blocks.push({ key: `slot-${s.id}`, start: toMinutes(row.start), end: toMinutes(row.end) });
    }
  }
  for (const e of props.timedEvents) {
    const range = todoMinutes(e);
    if (range) blocks.push({ key: `todo-${e.id}`, start: range.start, end: range.end });
  }
  return new Map(packColumns(blocks).map((b) => [b.key, b]));
});

function blockLayout(key: string) {
  return layout.value.get(key) ?? { key, left: 0, width: 100 };
}

const ruleLabel = (r: string) => (r === 'odd_week' ? '单周' : r === 'even_week' ? '双周' : '');

/** "09:00–09:45" for a timed todo (this component only ever renders todos
 * that already passed the todoMinutes() != null check, so both times exist). */
function eventTimeLabel(e: EventItem): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = new Date(e.startAt);
  const startLabel = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (!e.endAt) return startLabel;
  const end = new Date(e.endAt);
  const endLabel = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${startLabel}–${endLabel}`;
}

// --- current-time line ---
// Ticks every 30s (cheap: one Date + a handful of computed re-evaluations)
// so the line visibly creeps rather than jumping once a minute, without
// the render churn of a per-second timer.
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => { now.value = new Date(); }, 30_000);
});
onUnmounted(() => clearInterval(timer));

const isToday = computed(() => props.date === localIsoDate(now.value));
const nowTop = computed(() => {
  if (!isToday.value) return null;
  const top = timeToTop(now.value.getHours() * 60 + now.value.getMinutes());
  return top === null ? null : `${top}%`;
});
</script>

<template>
  <div class="day-col">
    <!-- Background blocks: activities shade the whole column width; lesson
         blocks are click targets for creating a course when empty, and
         otherwise just backdrop (the actual lesson card is rendered as its
         own positioned block below, alongside todos, so interval packing can
         place both in the same coordinate space). -->
    <div
      v-for="(row, ri) in daySchedule"
      :key="ri"
      class="time-bg-block"
      :class="{ 'time-bg-activity': row.kind === 'activity' }"
      :style="rowStyle(ri)"
      @click="row.kind === 'lesson' && row.period != null && !slotAt(row.period).length && emit('create-lesson', row.period)"
    />

    <!-- Lessons -->
    <template v-for="(row, ri) in daySchedule" :key="ri">
      <div v-if="row.kind === 'lesson' && row.period != null">
        <div
          v-for="s in slotAt(row.period)"
          :key="s.id"
          class="slot"
          :style="{
            borderLeftColor: s.classColor ?? 'var(--brand)',
            ...rowStyle(ri),
            left: `${blockLayout(`slot-${s.id}`).left}%`,
            width: `calc(${blockLayout(`slot-${s.id}`).width}% - 4px)`,
          }"
          @click="emit('edit-slot', s)"
        >
          <div class="slot-subject">
            {{ s.subject ?? '课程' }}
            <span v-if="ruleLabel(s.repeatRule)" class="badge">{{ ruleLabel(s.repeatRule) }}</span>
          </div>
          <div class="hint">{{ s.className ?? '—' }}</div>
          <div v-if="s.location" class="hint">{{ s.location }}</div>
          <button class="del" @click.stop="emit('remove-slot', s.id)">×</button>
        </div>
      </div>
    </template>

    <!-- Timed todos, positioned by their real start–end time and packed into
         a free column alongside any overlapping lesson. -->
    <div
      v-for="e in timedEvents"
      :key="e.id"
      class="todo-block"
      :class="{ done: e.isDone }"
      :style="{
        ...timeRangeStyle(todoMinutes(e)?.start ?? 0, todoMinutes(e)?.end ?? 0),
        left: `${blockLayout(`todo-${e.id}`).left}%`,
        width: `calc(${blockLayout(`todo-${e.id}`).width}% - 4px)`,
      }"
      :title="`${eventTimeLabel(e)} · ${e.title}`"
      @click="emit('edit-event', e)"
    >
      <input
        type="checkbox"
        :checked="e.isDone"
        @click.stop
        @change="emit('toggle-event', e, ($event.target as HTMLInputElement).checked)"
      />
      <div class="todo-block-text">
        <div class="todo-block-title">
          {{ e.title }}
          <span v-if="e.repeatWeekday != null" class="badge">每周</span>
        </div>
        <div class="hint">{{ eventTimeLabel(e) }}</div>
      </div>
    </div>

    <!-- Current-time line: only on today's column, only within the visible
         calendar range (see timeToTop). Drawn last so it sits on top. -->
    <div v-if="nowTop !== null" class="now-line" :style="{ top: nowTop }">
      <span class="now-line-dot" />
    </div>
  </div>
</template>

<style scoped>
.day-col {
  position: relative;
  height: 100%;
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

.badge { font-size: 10px; padding: 1px 5px; }

.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px solid var(--danger);
  z-index: 2;
  pointer-events: none;
}

.now-line-dot {
  position: absolute;
  left: -1px;
  top: -4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
</style>
