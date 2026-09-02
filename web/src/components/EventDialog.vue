<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, ApiError } from '@/api/client';
import { useClassStore } from '@/stores/classes';
import ModalDialog from '@/components/ModalDialog.vue';
import type { Envelope, EventItem } from '@/api/types';

const props = defineProps<{
  /** Existing todo to edit; omit to create a new one. */
  event?: EventItem | null;
  /** Pre-selected date (YYYY-MM-DD) when creating from a day view. */
  defaultDate?: string;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const classStore = useClassStore();
const error = ref('');
const saving = ref(false);

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** ISO weekday (1 = Monday … 7 = Sunday) of a "YYYY-MM-DD" string. */
function weekdayOf(dateStr: string): number {
  const iso = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return iso === 0 ? 7 : iso;
}

const form = ref({
  title: '',
  description: '',
  date: props.defaultDate ?? new Date().toISOString().slice(0, 10),
  time: '09:00',
  hasEnd: false,
  endDate: '',
  endTime: '',
  allDay: false,
  classId: '',
  repeats: false,
  repeatWeekday: weekdayOf(props.defaultDate ?? new Date().toISOString().slice(0, 10)),
});

/** Split the stored UTC instant into the local date/time the form edits. */
function hydrate() {
  if (!props.event) {
    const date = props.defaultDate ?? new Date().toISOString().slice(0, 10);
    form.value = {
      title: '',
      description: '',
      date,
      time: '09:00',
      hasEnd: false,
      endDate: '',
      endTime: '',
      allDay: false,
      classId: '',
      repeats: false,
      repeatWeekday: weekdayOf(date),
    };
    return;
  }

  const start = new Date(props.event.startAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const end = props.event.endAt ? new Date(props.event.endAt) : null;
  const date = toDate(start);

  form.value = {
    title: props.event.title,
    description: props.event.description ?? '',
    date,
    time: toTime(start),
    hasEnd: !!end,
    endDate: end ? toDate(end) : '',
    endTime: end ? toTime(end) : '',
    allDay: props.event.allDay,
    classId: props.event.classId ?? '',
    repeats: props.event.repeatWeekday != null,
    repeatWeekday: props.event.repeatWeekday ?? weekdayOf(date),
  };
}

watch(() => props.event, hydrate, { immediate: true });

async function save() {
  if (!form.value.title.trim()) {
    error.value = '请填写待办标题';
    return;
  }

  if (form.value.hasEnd) {
    const endDate = form.value.endDate || form.value.date;
    const endTime = form.value.allDay ? '23:59' : form.value.endTime || form.value.time;
    const startTime = form.value.allDay ? '00:00' : form.value.time;
    if (`${endDate}T${endTime}` < `${form.value.date}T${startTime}`) {
      error.value = '结束时间不能早于开始时间';
      return;
    }
  }

  error.value = '';
  saving.value = true;

  try {
    // An all-day item pins to local midnight; otherwise use the chosen time.
    // Building a local Date and letting toISOString() convert keeps the todo on
    // the day the teacher picked, whatever their timezone.
    const time = form.value.allDay ? '00:00' : form.value.time;
    const startAt = new Date(`${form.value.date}T${time}:00`).toISOString();

    let endAt: string | null = null;
    if (form.value.hasEnd) {
      const endDate = form.value.endDate || form.value.date;
      const endTime = form.value.allDay ? '23:59' : form.value.endTime || form.value.time;
      endAt = new Date(`${endDate}T${endTime}:00`).toISOString();
    }

    const payload = {
      title: form.value.title.trim(),
      description: form.value.description.trim() || null,
      startAt,
      endAt,
      allDay: form.value.allDay,
      classId: form.value.classId || null,
      repeatWeekday: form.value.repeats ? form.value.repeatWeekday : null,
    };

    if (props.event) {
      await api.patch<Envelope<EventItem>>(`/events/${props.event.id}`, payload);
    } else {
      await api.post<Envelope<EventItem>>('/events', payload);
    }

    emit('saved');
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!props.event) return;
  if (!confirm(`确定删除待办「${props.event.title}」吗？`)) return;

  saving.value = true;
  try {
    await api.del(`/events/${props.event.id}`);
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '删除失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModalDialog :title="props.event ? '编辑待办' : '新增待办'" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div class="field">
        <label>标题</label>
        <input
          v-model="form.title"
          class="input"
          required
          placeholder="如：收数学作业本"
          autofocus
        />
      </div>

      <div class="row">
        <div class="field" style="flex: 1">
          <label>日期</label>
          <input v-model="form.date" class="input" type="date" required />
        </div>
        <div v-if="!form.allDay" class="field" style="width: 120px">
          <label>时间</label>
          <input v-model="form.time" class="input" type="time" />
        </div>
      </div>

      <label class="check">
        <input v-model="form.allDay" type="checkbox" />
        <span>全天事项（不指定具体时间）</span>
      </label>

      <label class="check">
        <input v-model="form.hasEnd" type="checkbox" />
        <span>设置结束时间</span>
      </label>

      <div v-if="form.hasEnd" class="row">
        <div class="field" style="flex: 1">
          <label>结束日期</label>
          <input v-model="form.endDate" class="input" type="date" :placeholder="form.date" />
        </div>
        <div v-if="!form.allDay" class="field" style="width: 120px">
          <label>结束时间</label>
          <input v-model="form.endTime" class="input" type="time" :placeholder="form.time" />
        </div>
      </div>

      <label class="check">
        <input v-model="form.repeats" type="checkbox" />
        <span>每周重复</span>
      </label>

      <div v-if="form.repeats" class="field">
        <label>重复星期</label>
        <select v-model.number="form.repeatWeekday" class="select">
          <option v-for="(w, i) in WEEKDAYS" :key="i" :value="i + 1">{{ w }}</option>
        </select>
        <p class="hint">从「日期」当周开始，此后每周该星期都会出现；每周的完成状态各自独立</p>
      </div>

      <div class="field">
        <label>关联班级（可选）</label>
        <select v-model="form.classId" class="select">
          <option value="">不关联班级</option>
          <option v-for="c in classStore.items" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="field">
        <label>备注（可选）</label>
        <textarea v-model="form.description" class="textarea" />
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>
    </form>

    <template #footer>
      <button v-if="props.event" class="btn btn-danger" :disabled="saving" @click="remove">
        删除
      </button>
      <div class="spacer" />
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
</style>
