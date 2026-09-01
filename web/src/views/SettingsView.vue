<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import Sortable from 'sortablejs';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';
import { useTheme, type ThemeMode } from '@/composables/useTheme';
import {
  disablePush,
  enablePush,
  pushPermission,
  pushSupported,
  sendTestPush,
} from '@/api/push';

const auth = useAuthStore();
const router = useRouter();
const { mode: themeMode, setMode: setThemeMode } = useTheme();

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

// Short git commit hash of this build, baked in by vite.config.ts — lets a
// teacher (or us, reading a bug report) confirm which build is actually
// running without an API round-trip.
const appCommit = __APP_COMMIT__;

import type { DayScheduleItem } from '@/api/types';

const displayName = ref(auth.user?.displayName ?? '');
const periodsPerDay = ref(auth.user?.settings.periodsPerDay ?? 8);
const showWeekend = ref(auth.user?.settings.showWeekend ?? false);

// --- day schedule (作息时间表) ---
const DEFAULT_DAY_SCHEDULE: DayScheduleItem[] = [
  { key: 'morning_reading', kind: 'activity', label: '早读', start: '07:30', end: '07:50' },
  { key: 'p1', kind: 'lesson', label: '第1节', start: '08:00', end: '08:45', period: 1 },
  { key: 'p2', kind: 'lesson', label: '第2节', start: '09:00', end: '09:45', period: 2 },
  { key: 'eye_exercise_1', kind: 'activity', label: '眼操', start: '09:45', end: '09:50' },
  { key: 'p3', kind: 'lesson', label: '第3节', start: '10:00', end: '10:40', period: 3 },
  { key: 'p4', kind: 'lesson', label: '第4节', start: '10:55', end: '11:35', period: 4 },
  { key: 'lunch', kind: 'activity', label: '午餐', start: '11:35', end: '12:05' },
  { key: 'nap', kind: 'activity', label: '午休', start: '12:45', end: '13:25' },
  { key: 'p5', kind: 'lesson', label: '第5节', start: '13:40', end: '14:25', period: 5 },
  { key: 'eye_exercise_2', kind: 'activity', label: '眼操', start: '14:25', end: '14:30' },
  { key: 'big_break', kind: 'activity', label: '大课间', start: '14:30', end: '15:25' },
  { key: 'p6', kind: 'lesson', label: '第6节', start: '15:25', end: '16:10', period: 6 },
  { key: 'p7', kind: 'lesson', label: '第7节', start: '16:20', end: '17:00', period: 7 },
  { key: 'p8', kind: 'lesson', label: '第8节', start: '17:10', end: '17:50', period: 8 },
];

const daySchedule = ref<DayScheduleItem[]>(
  JSON.parse(
    JSON.stringify(
      auth.user?.settings.daySchedule?.length
        ? auth.user.settings.daySchedule
        : DEFAULT_DAY_SCHEDULE,
    ),
  ),
);

function addRow() {
  daySchedule.value.push({
    key: `row_${Date.now()}`,
    kind: 'activity',
    label: '新活动',
    start: '12:00',
    end: '12:30',
  });
}

function removeRow(i: number) {
  daySchedule.value.splice(i, 1);
}

// Drag-to-reorder (touch + mouse) via SortableJS, scoped to the ".ds-handle"
// grip so dragging never fights with the label input or time pickers inside
// each row. Sortable moves the DOM node itself; oldIndex/newIndex tell us how
// to replay that as an array splice so Vue's reactive state stays the source
// of truth (and a re-render always matches what's on screen).
const dsListEl = useTemplateRef<HTMLElement>('dsListEl');
let sortable: Sortable | null = null;

onMounted(() => {
  if (!dsListEl.value) return;
  sortable = Sortable.create(dsListEl.value, {
    handle: '.ds-handle',
    animation: 150,
    ghostClass: 'ds-row-ghost',
    // The native HTML5 DnD backend behaves inconsistently across mobile
    // WebViews and doesn't fire from synthetic events at all; the mouse/touch
    // fallback is what SortableJS itself recommends for touch reliability.
    forceFallback: true,
    // Let Sortable move the real DOM nodes during the drag — don't fight it
    // by also re-rendering through Vue mid-drag. Only sync `daySchedule` on
    // drop, once, so Vue's next render is a no-op (DOM order already matches
    // the new array order) instead of a second conflicting reorder.
    onEnd(evt) {
      const { oldIndex, newIndex } = evt;
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
      const [row] = daySchedule.value.splice(oldIndex, 1);
      daySchedule.value.splice(newIndex, 0, row);
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
});

function resetDaySchedule() {
  daySchedule.value = JSON.parse(JSON.stringify(DEFAULT_DAY_SCHEDULE));
}

async function saveDaySchedule() {
  error.value = '';
  message.value = '';
  for (const it of daySchedule.value) {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(it.start) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(it.end)) {
      error.value = `“${it.label}”的时间格式应为 HH:MM`;
      return;
    }
    if (it.start >= it.end) {
      error.value = `“${it.label}”的开始时间应早于结束时间`;
      return;
    }
    if (!it.label.trim()) {
      error.value = '每一行都需要填写名称';
      return;
    }
  }
  try {
    await auth.updateSettings({ daySchedule: daySchedule.value });
    // Server sorts + renumbers periods; adopt its version.
    daySchedule.value = JSON.parse(JSON.stringify(auth.user?.settings.daySchedule ?? []));
    message.value = '✓ 作息时间表已保存';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

// --- push reminders ---
const pushRemindersEnabled = ref(auth.user?.settings.pushRemindersEnabled ?? false);
const remindBeforeMinutes = ref(auth.user?.settings.remindBeforeMinutes ?? 5);
// "放学提醒" — independent of pushRemindersEnabled (server-side: lib/reminder.ts
// checks it on its own), but shares the same browser push subscription, so
// turning it on still needs enablePush() the first time nothing else has.
const endOfDayReminderEnabled = ref(auth.user?.settings.endOfDayReminderEnabled ?? false);
const pushBusy = ref(false);
const pushMsg = ref('');
const canPush = ref(false);
const permission = ref<NotificationPermission>('default');

// This app is public and teachers can be in any timezone, so reminders must be
// computed against *this* browser's zone — never assume the server's zone.
const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timeZone = ref(auth.user?.settings.timeZone || detectedTimeZone);
const timeZoneSaved = ref(Boolean(auth.user?.settings.timeZone));

onMounted(() => {
  canPush.value = pushSupported();
  permission.value = pushPermission();
});

async function saveTimeZone() {
  pushMsg.value = '';
  error.value = '';
  try {
    await auth.updateSettings({ timeZone: timeZone.value });
    timeZoneSaved.value = true;
    pushMsg.value = '✓ 时区已保存';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

// Both reminder kinds ride on the same browser push subscription, so it's
// only safe to tear that subscription down when neither toggle needs it —
// otherwise turning off "推送提醒" would silently also kill 放学提醒.
async function ensurePushSubscribed(): Promise<boolean> {
  const ok = await enablePush();
  permission.value = pushPermission();
  if (!ok) {
    error.value =
      permission.value === 'denied'
        ? '浏览器已拒绝通知权限，请在站点设置中手动开启'
        : '开启推送失败，可能是浏览器不支持或服务端未配置';
    return false;
  }
  // First time enabling push: lock in the browser's own timezone so
  // reminder times are computed correctly, unless already set explicitly.
  if (!timeZoneSaved.value) {
    timeZone.value = detectedTimeZone;
    await auth.updateSettings({ timeZone: detectedTimeZone });
    timeZoneSaved.value = true;
  }
  return true;
}

async function togglePush(on: boolean) {
  pushBusy.value = true;
  pushMsg.value = '';
  error.value = '';
  try {
    if (on) {
      if (!(await ensurePushSubscribed())) {
        pushRemindersEnabled.value = false;
        return;
      }
    } else if (!endOfDayReminderEnabled.value) {
      await disablePush();
    }
    await auth.updateSettings({ pushRemindersEnabled: on });
    pushRemindersEnabled.value = on;
    pushMsg.value = on ? '✓ 已开启推送提醒' : '已关闭推送提醒';
  } catch (e) {
    pushRemindersEnabled.value = !on;
    error.value = e instanceof ApiError ? e.message : '操作失败';
  } finally {
    pushBusy.value = false;
  }
}

async function toggleEndOfDayReminder(on: boolean) {
  pushBusy.value = true;
  pushMsg.value = '';
  error.value = '';
  try {
    if (on) {
      if (!(await ensurePushSubscribed())) {
        endOfDayReminderEnabled.value = false;
        return;
      }
    } else if (!pushRemindersEnabled.value) {
      await disablePush();
    }
    await auth.updateSettings({ endOfDayReminderEnabled: on });
    endOfDayReminderEnabled.value = on;
    pushMsg.value = on ? '✓ 已开启放学提醒' : '已关闭放学提醒';
  } catch (e) {
    endOfDayReminderEnabled.value = !on;
    error.value = e instanceof ApiError ? e.message : '操作失败';
  } finally {
    pushBusy.value = false;
  }
}

async function saveRemindMinutes() {
  pushMsg.value = '';
  error.value = '';
  const m = Number(remindBeforeMinutes.value);
  if (!Number.isFinite(m) || m < 1 || m > 120) {
    error.value = '提前分钟数需在 1–120 之间';
    return;
  }
  try {
    await auth.updateSettings({ remindBeforeMinutes: m });
    pushMsg.value = '✓ 提醒时间已保存';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function testPush() {
  pushBusy.value = true;
  pushMsg.value = '';
  try {
    const n = await sendTestPush();
    pushMsg.value = n > 0 ? `已发送测试通知到 ${n} 台设备` : '没有已注册的设备，请先开启推送';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '发送失败';
  } finally {
    pushBusy.value = false;
  }
}
const excellent = ref((auth.user?.settings.gradeThresholds.excellent ?? 0.85) * 100);
const good = ref((auth.user?.settings.gradeThresholds.good ?? 0.75) * 100);
const pass = ref((auth.user?.settings.gradeThresholds.pass ?? 0.6) * 100);

const currentPassword = ref('');
const newPassword = ref('');
const message = ref('');
const error = ref('');

async function saveProfile() {
  error.value = '';
  message.value = '';

  if (!displayName.value.trim()) {
    error.value = '称呼不能为空';
    return;
  }

  try {
    await auth.updateProfile(displayName.value.trim());
    message.value = '✓ 个人信息已保存';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function saveSettings() {
  error.value = '';
  message.value = '';

  if (!(excellent.value > good.value && good.value > pass.value)) {
    error.value = '等级阈值需满足：优秀 > 良好 > 及格';
    return;
  }

  try {
    await auth.updateSettings({
      periodsPerDay: periodsPerDay.value,
      showWeekend: showWeekend.value,
      gradeThresholds: {
        excellent: excellent.value / 100,
        good: good.value / 100,
        pass: pass.value / 100,
      },
    });
    message.value = '✓ 偏好设置已保存';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '保存失败';
  }
}

async function changePassword() {
  error.value = '';
  message.value = '';
  try {
    await auth.changePassword(currentPassword.value, newPassword.value);
    // The server revoked every token, so the user must sign in again.
    router.push({ name: 'login' });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '修改失败';
  }
}

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>个人设置</h1>
    </header>

    <p v-if="message" class="up">{{ message }}</p>
    <p v-if="error" class="error-text">{{ error }}</p>

    <div class="stack narrow">
      <section class="card">
        <div class="card-title">个人信息</div>
        <div class="stack">
          <div class="field">
            <label for="settings-email">邮箱</label>
            <input id="settings-email" class="input" :value="auth.user?.email" disabled />
          </div>
          <div class="field">
            <label for="settings-name">称呼</label>
            <!-- autocomplete="off" + an explicit id: without them Chrome treats
                 this as a generic profile field and autofills the browser
                 profile's name over the teacher's own. -->
            <input
              id="settings-name"
              v-model="displayName"
              class="input"
              autocomplete="off"
              maxlength="64"
            />
          </div>
          <button class="btn btn-primary" @click="saveProfile">保存</button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">外观</div>
        <div class="theme-switch">
          <button
            v-for="opt in themeOptions"
            :key="opt.value"
            type="button"
            class="theme-option"
            :class="{ active: themeMode === opt.value }"
            @click="setThemeMode(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">课表偏好</div>
        <div class="stack">
          <div class="field">
            <label>每天节次数</label>
            <input v-model.number="periodsPerDay" class="input" type="number" min="1" max="20" />
          </div>
          <label class="check">
            <input v-model="showWeekend" type="checkbox" />
            <span>在周视图中显示周六、周日</span>
          </label>
          <button class="btn btn-primary" @click="saveSettings">保存</button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">作息时间表</div>
        <p class="hint">
          用于日程表的时段排布。「课程」行对应排课节次（按出现顺序自动编号），
          「活动」行是眼操、午餐、午休、大课间等固定事件。
        </p>

        <p class="hint ds-drag-hint">按住 ⠿ 拖动可调整顺序</p>

        <div ref="dsListEl" class="ds-list">
          <div v-for="(row, i) in daySchedule" :key="row.key" class="ds-row">
            <div class="ds-row-top">
              <span class="ds-handle" title="拖动排序">⠿</span>
              <select v-model="row.kind" class="select ds-kind">
                <option value="lesson">课程</option>
                <option value="activity">活动</option>
              </select>
              <input v-model="row.label" class="input ds-label" maxlength="24" placeholder="名称" />
              <button class="btn btn-sm btn-danger ds-icon-btn" title="删除" @click="removeRow(i)">×</button>
            </div>
            <div class="ds-row-bottom">
              <input v-model="row.start" class="input ds-time" type="time" />
              <span class="ds-dash">–</span>
              <input v-model="row.end" class="input ds-time" type="time" />
            </div>
          </div>
        </div>

        <div class="row" style="margin-top: 10px; gap: 8px">
          <button class="btn btn-sm" @click="addRow">+ 添加一行</button>
          <button class="btn btn-sm" @click="resetDaySchedule">恢复默认</button>
          <div class="spacer" />
          <button class="btn btn-primary" @click="saveDaySchedule">保存作息</button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">推送提醒</div>
        <p class="hint">在课程或待办开始前提醒你。支持浏览器与已安装的 PWA，关闭页面也能收到。</p>

        <p v-if="pushMsg" class="up">{{ pushMsg }}</p>

        <div v-if="!canPush" class="hint" style="margin-top: 10px">
          当前浏览器不支持推送通知（iOS 需先「添加到主屏幕」并使用 iOS 16.4 以上版本）。
        </div>

        <div v-else class="stack" style="margin-top: 10px">
          <label class="check">
            <input
              type="checkbox"
              :checked="pushRemindersEnabled"
              :disabled="pushBusy"
              @change="togglePush(($event.target as HTMLInputElement).checked)"
            />
            <span>开启推送提醒（课程 / 待办）</span>
          </label>

          <label class="check">
            <input
              type="checkbox"
              :checked="endOfDayReminderEnabled"
              :disabled="pushBusy"
              @change="toggleEndOfDayReminder(($event.target as HTMLInputElement).checked)"
            />
            <span>开启放学提醒（今日作息结束 5 分钟后提醒）</span>
          </label>

          <div class="field">
            <label>时区</label>
            <input v-model="timeZone" class="input" placeholder="Asia/Shanghai" />
            <p class="hint">
              课程、待办与放学提醒都按这个时区计算触发时间。已按当前浏览器自动填入
              {{ detectedTimeZone }}，换设备/换地区后请重新确认。
            </p>
            <button class="btn btn-sm btn-primary" style="align-self: flex-start" @click="saveTimeZone">
              保存时区
            </button>
          </div>

          <div class="field">
            <label>提前提醒时间（分钟）</label>
            <input
              v-model.number="remindBeforeMinutes"
              class="input"
              type="number"
              min="1"
              max="120"
              :disabled="!pushRemindersEnabled"
            />
            <button
              class="btn btn-sm btn-primary"
              style="margin-top: 8px; align-self: flex-start"
              :disabled="!pushRemindersEnabled"
              @click="saveRemindMinutes"
            >
              保存
            </button>
          </div>

          <button
            class="btn btn-sm"
            style="align-self: flex-start"
            :disabled="pushBusy || !pushRemindersEnabled"
            @click="testPush"
          >
            发送测试通知
          </button>
        </div>

        <p class="hint" style="margin-top: 12px">
          <RouterLink :to="{ name: 'devices' }">设备管理</RouterLink>
          — 查看关联的推送设备与登录会话，可远程下线某台设备。
        </p>
      </section>

      <section class="card">
        <div class="card-title">成绩等级阈值</div>
        <p class="hint">按满分百分比计算，影响优秀率、及格率与等级饼图</p>
        <div class="stack" style="margin-top: 10px">
          <div class="field">
            <label>优秀线（%）</label>
            <input v-model.number="excellent" class="input" type="number" min="1" max="100" />
          </div>
          <div class="field">
            <label>良好线（%）</label>
            <input v-model.number="good" class="input" type="number" min="1" max="100" />
          </div>
          <div class="field">
            <label>及格线（%）</label>
            <input v-model.number="pass" class="input" type="number" min="1" max="100" />
          </div>
          <button class="btn btn-primary" @click="saveSettings">保存</button>
        </div>
      </section>

      <section class="card">
        <div class="card-title">修改密码</div>
        <div class="stack">
          <div class="field">
            <label>当前密码</label>
            <input v-model="currentPassword" class="input" type="password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>新密码</label>
            <input v-model="newPassword" class="input" type="password" autocomplete="new-password" />
            <span class="hint">8–64 位，需同时包含字母和数字。修改后需要重新登录。</span>
          </div>
          <button
            class="btn btn-primary"
            :disabled="!currentPassword || !newPassword"
            @click="changePassword"
          >
            修改密码
          </button>
        </div>
      </section>

      <section class="card">
        <button class="btn btn-danger btn-block" @click="logout">退出登录</button>
      </section>

      <p class="build-version">版本 {{ appCommit }}</p>
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 520px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }

.build-version {
  margin: 4px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

.theme-switch { display: flex; gap: 8px; flex-wrap: wrap; }
.theme-option {
  flex: 1;
  min-width: 96px;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.theme-option:hover { background: var(--hover-tint); }
.theme-option.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.ds-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.ds-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.ds-row-top { display: flex; align-items: center; gap: 6px; }
.ds-row-bottom { display: flex; align-items: center; gap: 6px; }
.ds-label { flex: 1; min-width: 0; }
.ds-kind { width: 76px; flex-shrink: 0; }
.ds-time { flex: 1; min-width: 0; }
.ds-dash { color: var(--text-faint); flex-shrink: 0; }
.ds-icon-btn { padding: 5px 9px; min-width: 32px; flex-shrink: 0; }

.ds-drag-hint { margin: 6px 0 0; }

/* touch-action: none stops the browser from treating a vertical finger drag
   here as a page scroll, so SortableJS's own touch handling gets the
   gesture instead — without it, dragging on mobile just scrolls the page. */
.ds-handle {
  flex-shrink: 0;
  padding: 4px 6px;
  color: var(--text-faint);
  font-size: 16px;
  line-height: 1;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.ds-handle:active { cursor: grabbing; }

.ds-row-ghost { opacity: 0.4; }

@media (max-width: 420px) {
  .ds-kind { width: 68px; }
}
</style>
