<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppNav from '@/components/AppNav.vue';

const route = useRoute();
const auth = useAuthStore();
const online = ref(navigator.onLine);

const showChrome = computed(() => auth.isAuthenticated && !route.meta.public);

function setOnline() {
  online.value = navigator.onLine;
}

onMounted(() => {
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
});

onUnmounted(() => {
  window.removeEventListener('online', setOnline);
  window.removeEventListener('offline', setOnline);
});
</script>

<template>
  <div :class="['app-shell', { 'with-nav': showChrome }]">
    <div v-if="!online" class="offline-banner">
      当前处于离线状态，显示的是缓存数据，暂时无法保存修改
    </div>

    <AppNav v-if="showChrome" />

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-main {
  min-height: 100vh;
}

/* Keep content clear of the iOS status bar / notch in standalone PWA mode.
   viewport-fit=cover (index.html) lets the page draw under it otherwise. */
@media (max-width: 768px) {
  .app-shell.with-nav {
    padding-top: env(safe-area-inset-top);
  }
}

@media (min-width: 769px) {
  .app-shell.with-nav .app-main {
    margin-left: var(--sidebar-width);
    min-height: calc(100vh - 0px);
  }
}
</style>
