import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});
vi.stubGlobal('window', { location: { origin: 'http://localhost' } });

const { useAuthStore } = await import('../auth');
const { useClassStore } = await import('../classes');
const { tokenStore } = await import('../../api/client');

/** Records which caches were deleted so tests can assert the purge happened. */
function stubCaches(existing: string[]) {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: async () => existing,
    delete: async (k: string) => {
      deleted.push(k);
      return true;
    },
  });
  return deleted;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

const AUTH_PAYLOAD = {
  data: {
    user: {
      id: 'u1',
      email: 'teacher@example.com',
      displayName: '李老师',
      avatarUrl: null,
      settings: {},
      createdAt: '2026-08-30T00:00:00.000Z',
    },
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 7200,
  },
};

beforeEach(() => {
  store.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
});

describe('auth store: cross-account data isolation', () => {
  it('logout clears tokens, in-memory classes and the API caches', async () => {
    const deleted = stubCaches(['td-data', 'workbox-precache-v2']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));

    const auth = useAuthStore();
    const classes = useClassStore();

    tokenStore.set('access-1', 'refresh-1');
    auth.user = AUTH_PAYLOAD.data.user as never;
    // Teacher A's roster is sitting in memory.
    classes.items = [{ id: 'c1', name: 'A 的班级' }] as never;
    classes.loaded = true;

    await auth.logout();

    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
    expect(auth.user).toBeNull();
    // Teacher A's classes must not survive into the next session.
    expect(classes.items).toHaveLength(0);
    expect(classes.loaded).toBe(false);
    expect(deleted).toContain('td-data');
  });

  it('logout still clears local state when the server call fails', async () => {
    const deleted = stubCaches(['td-data']);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const auth = useAuthStore();
    tokenStore.set('access-1', 'refresh-1');
    auth.user = AUTH_PAYLOAD.data.user as never;

    await auth.logout();

    expect(tokenStore.access).toBeNull();
    expect(auth.user).toBeNull();
    expect(deleted).toContain('td-data');
  });

  it('login purges caches left behind by a previous session', async () => {
    // Teacher A never logged out cleanly: their data is still cached.
    const deleted = stubCaches(['td-data']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, AUTH_PAYLOAD)));

    const auth = useAuthStore();
    const classes = useClassStore();
    classes.items = [{ id: 'stale', name: 'A 的班级' }] as never;

    await auth.login('teacher-b@example.com', 'Passw0rd123');

    expect(deleted).toContain('td-data');
    expect(classes.items).toHaveLength(0);
    expect(auth.user?.email).toBe('teacher@example.com');
  });

  it('register purges caches before adopting the new identity', async () => {
    const deleted = stubCaches(['td-data']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, AUTH_PAYLOAD)));

    const auth = useAuthStore();
    await auth.register('new@example.com', 'Passw0rd123', '新老师');

    expect(deleted).toContain('td-data');
    expect(tokenStore.access).toBe('access-1');
  });

  it('a failed session restore clears everything rather than leaving a half-session', async () => {
    const deleted = stubCaches(['td-data']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } })),
    );

    const auth = useAuthStore();
    tokenStore.set('dead-access', '');

    const ok = await auth.loadSession();

    expect(ok).toBe(false);
    expect(tokenStore.access).toBeNull();
    expect(auth.user).toBeNull();
    expect(deleted).toContain('td-data');
  });

  it('changing the password clears the local session and caches', async () => {
    const deleted = stubCaches(['td-data']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));

    const auth = useAuthStore();
    tokenStore.set('access-1', 'refresh-1');
    auth.user = AUTH_PAYLOAD.data.user as never;

    await auth.changePassword('OldPassw0rd', 'NewPassw0rd123');

    expect(tokenStore.access).toBeNull();
    expect(auth.user).toBeNull();
    expect(deleted).toContain('td-data');
  });
});
