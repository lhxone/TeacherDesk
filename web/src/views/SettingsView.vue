<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';
import {
  disablePush,
  enablePush,
  pushPermission,
  pushSupported,
  sendTestPush,
} from '@/api/push';

const auth = useAuthStore();
const router = useRouter();

const displayName = ref(auth.user?.displayName ?? '');
const periodsPerDay = ref(auth.user?.settings.periodsPerDay ?? 8);
const showWeekend = ref(auth.user?.settings.showWeekend ?? false);

// --- push reminders ---
const pushRemindersEnabled = ref(auth.user?.settings.pushRemindersEnabled ?? false);
const remindBeforeMinutes = ref(auth.user?.settings.remindBeforeMinutes ?? 5);
const pushBusy = ref(false);
const pushMsg = ref('');
const canPush = ref(false);
const permission = ref<NotificationPermission>('default');

onMounted(() => {
  canPush.value = pushSupported();
  permission.value = pushPermission();
});

async function togglePush(on: boolean) {
  pushBusy.value = true;
  pushMsg.value = '';
  error.value = '';
  try {
    if (on) {
      const ok = await enablePush();
      permission.value = pushPermission();
      if (!ok) {
        pushRemindersEnabled.value = false;
        error.value =
          permission.value === 'denied'
            ? '浏览器已拒绝通知权限，请在站点设置中手动开启'
            : '开启推送失败，可能是浏览器不支持或服务端未配置';
        return;
      }
    } else {
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
            <span>开启推送提醒</span>
          </label>

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
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 520px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
</style>
