<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useClassStore } from '@/stores/classes';
import EventDialog from '@/components/EventDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import WeatherCard from '@/components/WeatherCard.vue';
import type { AgendaDay, Envelope, EventItem } from '@/api/types';

const auth = useAuthStore();
const classStore = useClassStore();

const today = new Date().toISOString().slice(0, 10);
const agenda = ref<AgendaDay | null>(null);
const loading = ref(true);

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

async function reloadAgenda() {
  const res = await api.get<Envelope<AgendaDay[]>>('/schedule/agenda', { date: today });
  agenda.value = res.data[0] ?? null;
}

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const pendingEvents = computed(() => agenda.value?.events.filter((e) => !e.isDone) ?? []);

// Home timeline: activities plus only the lessons that actually have a class
// scheduled — empty periods ("空堂") are noise on the dashboard. The full
// timeline (every period) lives on the schedule day view.
const homeTimeline = computed(
  () => agenda.value?.timeline.filter((it) => it.kind === 'activity' || it.slotId) ?? [],
);

async function toggleEvent(id: string, isDone: boolean) {
  await api.patch(`/events/${id}`, { isDone });
  const ev = agenda.value?.events.find((e) => e.id === id);
  if (ev) ev.isDone = isDone;
}

onMounted(async () => {
  try {
    const [res] = await Promise.all([
      api.get<Envelope<AgendaDay[]>>('/schedule/agenda', { date: today }),
      classStore.ensureLoaded(),
    ]);
    agenda.value = res.data[0] ?? null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>{{ greeting }}，{{ auth.user?.displayName }}</h1>
        <p class="hint">{{ today }} · 今日日程与待办</p>
      </div>
    </header>

    <WeatherCard />

    <div v-if="loading" class="empty">加载中…</div>

    <div v-else class="stack">
      <section class="card">
        <div class="card-title">今日日程</div>
        <EmptyState v-if="!homeTimeline.length" icon="calendar" title="今天没有课程安排">
          享受一个空闲的教学日
        </EmptyState>
        <ul v-else class="lesson-list">
          <li
            v-for="(item, i) in homeTimeline"
            :key="i"
            class="lesson"
            :class="{ activity: item.kind === 'activity' }"
          >
            <span
              class="bar"
              :style="{
                background:
                  item.kind === 'lesson' ? (item.classColor ?? 'var(--brand)') : 'var(--border-strong)',
              }"
            />
            <div class="lesson-period">
              <strong>{{ item.label }}</strong>
              <span class="hint">{{ item.start }}–{{ item.end }}</span>
            </div>
            <div class="lesson-main">
              <template v-if="item.kind === 'lesson'">
                <div class="lesson-title">{{ item.subject ?? (item.slotId ? '课程' : '空堂') }}</div>
                <div v-if="item.slotId" class="hint">
                  {{ item.className ?? '未关联班级' }}
                  <template v-if="item.location"> · {{ item.location }}</template>
                </div>
              </template>
              <div v-else class="hint">课间活动</div>
            </div>
          </li>
        </ul>
      </section>

      <section class="card">
        <div class="row" style="margin-bottom: 12px">
          <div class="card-title" style="margin: 0">今日待办（{{ pendingEvents.length }}）</div>
          <div class="spacer" />
          <button class="btn btn-sm btn-primary" @click="openCreateEvent">+ 新增待办</button>
        </div>

        <p v-if="!agenda?.events.length" class="empty-inline">
          今天没有待办事项，点击右上角添加
        </p>

        <ul v-else class="todo-list">
          <li v-for="e in agenda.events" :key="e.id" class="todo">
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
          </li>
        </ul>
      </section>

      <section>
        <div class="card-title">我的班级</div>
        <EmptyState v-if="!classStore.items.length" icon="classes" title="还没有班级">
          <RouterLink :to="{ name: 'classes' }">去创建第一个班级</RouterLink>
        </EmptyState>
        <div v-else class="grid">
          <RouterLink
            v-for="c in classStore.items"
            :key="c.id"
            :to="{ name: 'class-detail', params: { classId: c.id } }"
            class="card class-card"
          >
            <span class="class-color" :style="{ background: c.color }" />
            <div class="class-name">{{ c.name }}</div>
            <div class="hint">{{ c.subject ?? '未设学科' }} · {{ c.studentCount }} 人</div>
          </RouterLink>
        </div>
      </section>
    </div>

    <EventDialog
      v-if="showEventDialog"
      :event="editingEvent"
      :default-date="today"
      @close="showEventDialog = false"
      @saved="reloadAgenda"
    />
  </div>
</template>

<style scoped>
.lesson-list,
.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lesson {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.bar { width: 4px; align-self: stretch; border-radius: 2px; }
.lesson-period { display: flex; flex-direction: column; min-width: 96px; }
.lesson-title { font-weight: 500; }
.lesson.activity { background: var(--bg); }

.todo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
}

.todo-title { cursor: pointer; }
.todo-title:hover { color: var(--brand); }
.todo .done { color: var(--text-faint); text-decoration: line-through; }

.class-card { position: relative; color: inherit; overflow: hidden; }
.class-color { position: absolute; inset: 0 auto 0 0; width: 4px; }
.class-name { font-weight: 600; margin-bottom: 2px; }
</style>
