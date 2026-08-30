<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, tokenStore } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import {
  listDevices,
  revokeSession,
  revokeSubscription,
  type DeviceList,
} from '@/api/devices';
import { pushPermission, pushSupported } from '@/api/push';

const auth = useAuthStore();
const router = useRouter();

const data = ref<DeviceList | null>(null);
const loading = ref(true);
const error = ref('');
const busy = ref('');

const currentSessionId = tokenStore.session;
const permission = ref<NotificationPermission>('default');
const supported = ref(false);

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

async function reload() {
  try {
    data.value = await listDevices();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

async function removeSubscription(id: string) {
  if (!confirm('确定移除这台推送设备吗？该设备将不再收到提醒。')) return;
  busy.value = id;
  error.value = '';
  try {
    await revokeSubscription(id);
    await reload();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '操作失败';
  } finally {
    busy.value = '';
  }
}

async function removeSession(id: string) {
  const isCurrent = id === currentSessionId;
  const msg = isCurrent
    ? '这是当前设备，下线后需要重新登录。确定继续吗？'
    : '确定下线该设备吗？该设备下次操作会被要求重新登录。';
  if (!confirm(msg)) return;
  busy.value = id;
  error.value = '';
  try {
    await revokeSession(id);
    if (isCurrent) {
      await auth.clearLocalIdentity();
      router.push({ name: 'login' });
      return;
    }
    await reload();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '操作失败';
  } finally {
    busy.value = '';
  }
}

onMounted(() => {
  supported.value = pushSupported();
  permission.value = pushPermission();
  reload();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>设备管理</h1>
      <RouterLink :to="{ name: 'settings' }" class="btn btn-sm">返回设置</RouterLink>
    </header>

    <p v-if="error" class="error-text">{{ error }}</p>
    <div v-if="loading" class="empty">加载中…</div>

    <div v-else class="stack narrow">
      <section class="card">
        <div class="card-title">推送状态</div>
        <ul class="status">
          <li>
            <span>服务端推送</span>
            <span :class="data?.pushEnabled ? 'ok' : 'off'">
              {{ data?.pushEnabled ? '已启用' : '未配置（管理员需设置 VAPID 密钥）' }}
            </span>
          </li>
          <li>
            <span>本浏览器</span>
            <span v-if="!supported" class="off">不支持推送</span>
            <span v-else :class="permission === 'granted' ? 'ok' : 'off'">
              {{
                permission === 'granted'
                  ? '已授权'
                  : permission === 'denied'
                    ? '已拒绝（需在浏览器站点设置中开启）'
                    : '未授权'
              }}
            </span>
          </li>
        </ul>
      </section>

      <section class="card">
        <div class="card-title">推送设备（{{ data?.subscriptions.length ?? 0 }}）</div>
        <p v-if="!data?.subscriptions.length" class="empty-inline">
          还没有已注册的推送设备。在「个人设置 → 推送提醒」开启后，此处会列出当前浏览器。
        </p>
        <ul v-else class="dev-list">
          <li v-for="s in data.subscriptions" :key="s.id">
            <div class="dev-main">
              <div class="dev-name">{{ s.label ?? '未知设备' }}</div>
              <div class="hint">注册于 {{ fmt(s.createdAt) }} · 最近活跃 {{ fmt(s.lastSeenAt) }}</div>
            </div>
            <button class="btn btn-sm btn-danger" :disabled="busy === s.id" @click="removeSubscription(s.id)">
              移除
            </button>
          </li>
        </ul>
      </section>

      <section class="card">
        <div class="card-title">登录会话（{{ data?.sessions.length ?? 0 }}）</div>
        <ul class="dev-list">
          <li v-for="s in data?.sessions ?? []" :key="s.id">
            <div class="dev-main">
              <div class="dev-name">
                {{ s.deviceInfo ?? '未知设备' }}
                <span v-if="s.id === currentSessionId" class="badge">本机</span>
              </div>
              <div class="hint">登录于 {{ fmt(s.createdAt) }} · 有效期至 {{ fmt(s.expiresAt) }}</div>
            </div>
            <button class="btn btn-sm btn-danger" :disabled="busy === s.id" @click="removeSession(s.id)">
              {{ s.id === currentSessionId ? '下线并登出' : '下线' }}
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 560px; }

.status { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.status li { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.status .ok { color: var(--success); }
.status .off { color: var(--text-muted); text-align: right; }

.dev-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dev-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.dev-main { flex: 1; min-width: 0; }
.dev-name { font-weight: 500; }
.badge { font-size: 10px; padding: 1px 6px; margin-left: 6px; }
</style>
