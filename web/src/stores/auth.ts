import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, purgeApiCaches, tokenStore } from '@/api/client';
import { disablePush, syncPushSubscription } from '@/api/push';
import { useClassStore } from '@/stores/classes';
import type { AuthResult, Envelope, User } from '@/api/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const loading = ref(false);

  const isAuthenticated = computed(() => Boolean(user.value));

  async function register(email: string, password: string, displayName: string) {
    const res = await api.post<Envelope<AuthResult>>('/auth/register', {
      email,
      password,
      displayName,
    });
    // Purge before adopting the new identity: a previous session that ended
    // uncleanly (crash, closed tab, expired token) can leave another teacher's
    // rosters and scores in the SW cache.
    await purgeApiCaches();
    useClassStore().$reset();

    tokenStore.set(res.data.accessToken, res.data.refreshToken);
    user.value = res.data.user;
  }

  async function login(email: string, password: string, rememberMe = false) {
    const res = await api.post<Envelope<AuthResult>>('/auth/login', {
      email,
      password,
      rememberMe,
    });

    await purgeApiCaches();
    useClassStore().$reset();

    tokenStore.set(res.data.accessToken, res.data.refreshToken);
    user.value = res.data.user;
    void syncPushSubscription();
  }

  async function logout() {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.refresh });
    } catch {
      // Logging out locally matters even if the server call fails.
    }
    await clearLocalIdentity();
  }

  /**
   * Drop every trace of the signed-in teacher from this browser: tokens,
   * in-memory stores, and the Service Worker's API caches.
   *
   * The SW caches are keyed by URL alone, so a second teacher signing in on the
   * same browser could otherwise be served the first one's students, phone
   * numbers and scores. Also called on hard auth failure, not just on an
   * explicit logout.
   */
  async function clearLocalIdentity() {
    // Drop this device's push subscription first (while the token still works),
    // so a shared browser does not keep delivering the previous teacher's
    // reminders after they sign out.
    await disablePush().catch(() => {});
    tokenStore.clear();
    user.value = null;
    useClassStore().$reset();
    await purgeApiCaches();
  }

  /** Restore the session on boot; returns false when the stored token is dead. */
  async function loadSession(): Promise<boolean> {
    if (!tokenStore.access) return false;
    loading.value = true;
    try {
      const res = await api.get<Envelope<User>>('/auth/me');
      user.value = res.data;
      void syncPushSubscription();
      return true;
    } catch {
      await clearLocalIdentity();
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function updateSettings(settings: Partial<User['settings']>) {
    const res = await api.patch<Envelope<User>>('/auth/me', { settings });
    user.value = res.data;
  }

  async function updateProfile(displayName: string) {
    const res = await api.patch<Envelope<User>>('/auth/me', { displayName });
    user.value = res.data;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    await api.post('/auth/change-password', { currentPassword, newPassword });
    // Server revoked every refresh token, so this session must re-authenticate.
    await clearLocalIdentity();
  }

  return {
    user,
    loading,
    isAuthenticated,
    register,
    login,
    logout,
    clearLocalIdentity,
    loadSession,
    updateSettings,
    updateProfile,
    changePassword,
  };
});
