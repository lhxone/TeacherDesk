<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';

const auth = useAuthStore();
const router = useRouter();

const displayName = ref('');
const email = ref('');
const password = ref('');
const confirm = ref('');
const error = ref('');
const submitting = ref(false);

// Mirrors the server rule (PRD §3.1.1) so the user gets feedback before submit.
const passwordValid = computed(
  () =>
    password.value.length >= 8 &&
    password.value.length <= 64 &&
    /[a-zA-Z]/.test(password.value) &&
    /[0-9]/.test(password.value),
);

const canSubmit = computed(
  () =>
    displayName.value.trim() &&
    email.value.trim() &&
    passwordValid.value &&
    password.value === confirm.value,
);

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    await auth.register(email.value, password.value, displayName.value);
    router.push({ name: 'home' });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '注册失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-card" @submit.prevent="submit">
      <div class="auth-brand">
        <span class="mark">🎓</span>
        <h1>创建账号</h1>
        <p class="hint">开始使用教师工作台</p>
      </div>

      <div class="field">
        <label for="name">你的称呼</label>
        <input id="name" v-model="displayName" class="input" required placeholder="如：李老师" />
      </div>

      <div class="field">
        <label for="email">邮箱</label>
        <input id="email" v-model="email" class="input" type="email" required autocomplete="email" />
      </div>

      <div class="field">
        <label for="password">密码</label>
        <input
          id="password"
          v-model="password"
          class="input"
          type="password"
          required
          autocomplete="new-password"
        />
        <span class="hint" :class="{ 'error-text': password && !passwordValid }">
          8–64 位，需同时包含字母和数字
        </span>
      </div>

      <div class="field">
        <label for="confirm">确认密码</label>
        <input
          id="confirm"
          v-model="confirm"
          class="input"
          type="password"
          required
          autocomplete="new-password"
        />
        <span v-if="confirm && password !== confirm" class="error-text">两次输入的密码不一致</span>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <button
        class="btn btn-primary btn-block btn-lg"
        type="submit"
        :disabled="submitting || !canSubmit"
      >
        {{ submitting ? '注册中…' : '注册并登录' }}
      </button>

      <p class="switch hint">
        已有账号？
        <RouterLink :to="{ name: 'login' }">去登录</RouterLink>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: linear-gradient(160deg, #eff6ff, #f8fafc 60%);
}

.auth-card {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-brand { text-align: center; margin-bottom: 4px; }
.auth-brand .mark { font-size: 34px; }
.auth-brand h1 { margin: 6px 0 4px; }
.switch { text-align: center; margin: 4px 0 0; }
</style>
