<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import NavIcons from '@/components/icons/NavIcons.vue';

const auth = useAuthStore();
const router = useRouter();

// Mobile bottom tabs mirror PRD §3.8 (首页 / 班级 / 课堂工具 / 成绩 / 我的),
// except the 4th slot is 知识中心 instead of 课堂工具 — 课堂工具 (抽签/分组/
// 座位) is still one tap away from the home page's quick-links row, and desk
// -bound tasks like browsing/uploading teaching resources benefit more from
// a persistent bottom-tab slot on mobile.
const links = [
  { name: 'home', label: '首页', icon: 'home' as const },
  { name: 'classes', label: '班级', icon: 'classes' as const },
  { name: 'schedule', label: '日程', icon: 'schedule' as const },
  { name: 'knowledge-center', label: '知识', icon: 'knowledge' as const },
  { name: 'settings', label: '我的', icon: 'settings' as const },
];

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <!-- Desktop: left sidebar -->
  <aside class="sidebar hide-mobile">
    <div class="brand">
      <span class="brand-mark"><NavIcons name="logo" /></span>
      <span class="brand-name">教师工作台</span>
    </div>

    <nav class="side-links">
      <RouterLink
        v-for="l in links"
        :key="l.name"
        :to="{ name: l.name }"
        class="side-link"
        active-class="active"
      >
        <span class="icon"><NavIcons :name="l.icon" /></span>
        <span>{{ l.label }}</span>
      </RouterLink>
    </nav>

    <div class="side-footer">
      <div class="user-name">{{ auth.user?.displayName }}</div>
      <button class="btn btn-sm btn-block" @click="logout">退出登录</button>
    </div>
  </aside>

  <!-- Mobile: bottom tab bar -->
  <nav class="tabbar hide-desktop">
    <RouterLink
      v-for="l in links"
      :key="l.name"
      :to="{ name: l.name }"
      class="tab"
      active-class="active"
    >
      <span class="tab-icon"><NavIcons :name="l.icon" /></span>
      <span class="tab-label">{{ l.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 18px;
  font-weight: 600;
  font-size: 16px;
}

.brand-mark { display: inline-flex; color: var(--brand); }
.brand-mark svg { width: 22px; height: 22px; }

.side-links { display: flex; flex-direction: column; gap: 2px; flex: 1; }

.side-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}

.side-link:hover { background: var(--hover-tint); color: var(--text); }
.side-link.active { background: var(--brand-soft); color: var(--brand-dark); }

.side-link .icon { display: inline-flex; }
.side-link .icon svg { width: 18px; height: 18px; }

.side-footer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-name {
  font-size: 13px;
  color: var(--text-muted);
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tabbar {
  position: fixed;
  inset: auto 0 0 0;
  /* The bar itself is --nav-height tall; the safe-area inset is extra space
     below it so the tab contents stay vertically centred in the visible bar
     instead of being squeezed upward on notched phones. */
  height: calc(var(--nav-height) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  z-index: 30;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.2;
}

.tab.active { color: var(--brand); }
.tab-icon { display: inline-flex; line-height: 1; }
.tab-icon svg { width: 21px; height: 21px; }
</style>
