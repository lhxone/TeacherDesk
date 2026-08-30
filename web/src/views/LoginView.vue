<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/api/client';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const rememberMe = ref(true);
const error = ref('');
const submitting = ref(false);

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    await auth.login(email.value, password.value, rememberMe.value);
    const redirect = route.query.redirect as string | undefined;
    router.push(redirect ?? { name: 'home' });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试';
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
        <h1>教师工作台</h1>
        <p class="hint">登录以管理你的班级、日程与成绩</p>
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
          autocomplete="current-password"
        />
      </div>

      <label class="remember">
        <input v-model="rememberMe" type="checkbox" />
        <span>记住我（30 天内免登录）</span>
      </label>

      <p v-if="error" class="error-text">{{ error }}</p>

      <button class="btn btn-primary btn-block btn-lg" type="submit" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </button>

      <p class="switch hint">
        还没有账号？
        <RouterLink :to="{ name: 'register' }">立即注册</RouterLink>
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

.remember {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-muted);
}

.switch { text-align: center; margin: 4px 0 0; }
</style>
