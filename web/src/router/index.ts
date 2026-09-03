import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { tokenStore } from '@/api/client';

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
  { path: '/classes', name: 'classes', component: () => import('@/views/ClassesView.vue') },
  { path: '/classes/:classId', name: 'class-detail', component: () => import('@/views/ClassDetailView.vue'), props: true },
  { path: '/students/:studentId', name: 'student-detail', component: () => import('@/views/StudentDetailView.vue'), props: true },
  { path: '/schedule', name: 'schedule', component: () => import('@/views/ScheduleView.vue') },
  { path: '/classes/:classId/seating', name: 'seating', component: () => import('@/views/SeatingView.vue'), props: true },
  { path: '/tools', name: 'tools', component: () => import('@/views/ToolsView.vue') },
  { path: '/exams/:examId/entry', name: 'score-entry', component: () => import('@/views/ScoreEntryView.vue'), props: true },
  { path: '/analytics/class/:classId', name: 'class-analytics', component: () => import('@/views/ClassAnalyticsView.vue'), props: true },
  { path: '/analytics/student/:studentId', name: 'student-analytics', component: () => import('@/views/StudentAnalyticsView.vue'), props: true },
  { path: '/knowledge', name: 'knowledge-center', component: () => import('@/views/KnowledgeCenterView.vue') },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  { path: '/devices', name: 'devices', component: () => import('@/views/DevicesView.vue') },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  // Restore the session once, so a page refresh does not bounce to /login.
  if (!auth.user && tokenStore.access) {
    await auth.loadSession();
  }

  if (to.meta.public) {
    return auth.isAuthenticated && to.name !== 'not-found' ? { name: 'home' } : true;
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});
