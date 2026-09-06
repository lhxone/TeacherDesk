import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// jsdom-free: stub the browser globals the client touches.
const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
});

vi.stubGlobal('window', { location: { origin: 'http://localhost' } });

const { api, tokenStore, ApiError, setAuthFailureHandler, purgeApiCaches } = await import(
  '../client'
);

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  store.clear();
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

describe('token store', () => {
  it('round-trips tokens through localStorage', () => {
    tokenStore.set('access-1', 'refresh-1');
    expect(tokenStore.access).toBe('access-1');
    expect(tokenStore.refresh).toBe('refresh-1');

    tokenStore.clear();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });
});

describe('request', () => {
  it('attaches the bearer token when present', async () => {
    tokenStore.set('access-1', 'refresh-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/classes');

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer access-1');
  });

  it('serialises query parameters and drops empty ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/classes', { status: 'active', page: 2, empty: '', missing: undefined });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('page=2');
    expect(url).not.toContain('empty=');
    expect(url).not.toContain('missing=');
  });

  it('throws a typed ApiError carrying the server error envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'CONFLICT', message: '学号已存在', details: [{ field: 'studentNo', message: '重复' }] },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/students', {})).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: '学号已存在',
    });
  });

  it('returns undefined for a 204 without parsing a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.del('/classes/x')).resolves.toBeUndefined();
  });

  it('surfaces a network failure as a NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));

    await expect(api.get('/classes')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('refreshes once on 401 and replays the original request', async () => {
    tokenStore.set('expired', 'refresh-1');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { accessToken: 'fresh', refreshToken: 'refresh-2' } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ data: { ok: boolean } }>('/classes');

    expect(result.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(tokenStore.access).toBe('fresh');
    // The rotated refresh token must replace the old one.
    expect(tokenStore.refresh).toBe('refresh-2');
  });

  it('clears tokens and notifies when the refresh itself fails', async () => {
    tokenStore.set('expired', 'refresh-dead');
    const onFail = vi.fn();
    setAuthFailureHandler(onFail);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/classes')).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.access).toBeNull();
    expect(onFail).toHaveBeenCalled();

    setAuthFailureHandler(() => {});
  });

  it('collapses concurrent 401s into a single refresh call', async () => {
    tokenStore.set('expired', 'refresh-1');

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(200, { data: { accessToken: 'fresh', refreshToken: 'refresh-2' } }),
        );
      }
      // Both original requests 401 once, then succeed on replay.
      return Promise.resolve(
        tokenStore.access === 'fresh'
          ? jsonResponse(200, { data: { ok: true } })
          : jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }),
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([api.get('/classes'), api.get('/students')]);

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('purges only TeacherDesk API caches, leaving unrelated ones alone', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['td-data', 'workbox-precache-v2', 'td-legacy-roster', 'other-app'],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      },
    });

    await purgeApiCaches();

    // Every td-* cache goes; the precache and other origins' caches stay.
    expect(deleted.sort()).toEqual(['td-data', 'td-legacy-roster']);
  });

  it('does not throw when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(purgeApiCaches()).resolves.toBeUndefined();
  });

  it('does not throw when Cache Storage access is blocked', async () => {
    vi.stubGlobal('caches', {
      keys: async () => {
        throw new DOMException('denied', 'SecurityError');
      },
      delete: async () => true,
    });

    // A blocked purge must never prevent the user from signing out.
    await expect(purgeApiCaches()).resolves.toBeUndefined();
  });

  it('handles a non-JSON error body (e.g. nginx HTML error page) without throwing a parse error', async () => {
    const htmlResponse = {
      ok: false,
      status: 413,
      text: async () => '<html><body><h1>413 Request Entity Too Large</h1></body></html>',
    } as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse));

    await expect(api.post('/resources', {})).rejects.toMatchObject({
      status: 413,
      code: 'INTERNAL_ERROR',
    });
  });

  it('does not clear tokens when the refresh call itself hits a network error', async () => {
    tokenStore.set('expired', 'refresh-1');
    const onFail = vi.fn();
    setAuthFailureHandler(onFail);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    // Being offline while the access token happens to be stale must not look
    // like the server rejecting the session — that would wipe a refresh
    // token that's still perfectly valid.
    await expect(api.get('/classes')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(tokenStore.access).toBe('expired');
    expect(tokenStore.refresh).toBe('refresh-1');
    expect(onFail).not.toHaveBeenCalled();

    setAuthFailureHandler(() => {});
  });

  it('uploads a single-field file through the same refresh-and-retry path as JSON requests', async () => {
    tokenStore.set('expired', 'refresh-1');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { accessToken: 'fresh', refreshToken: 'refresh-2' } }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { data: { id: 'r1' } }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['a,b'], 'roster.xlsx');
    const result = await api.upload('/students/import', file);

    expect((result as { data: { id: string } }).data.id).toBe('r1');
    expect(tokenStore.access).toBe('fresh');
    // The retried request must still carry a FormData body, not JSON.
    const retriedCall = fetchMock.mock.calls[2][1];
    expect(retriedCall.body).toBeInstanceOf(FormData);
    expect(retriedCall.headers['Content-Type']).toBeUndefined();
  });

  it('does not attempt a refresh when no refresh token is stored', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/classes')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
