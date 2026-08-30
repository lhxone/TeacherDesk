<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';

const auth = useAuthStore();
const router = useRouter();

const displayName = ref(auth.user?.displayName ?? '');
const periodsPerDay = ref(auth.user?.settings.periodsPerDay ?? 8);
const showWeekend = ref(auth.user?.settings.showWeekend ?? false);
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
