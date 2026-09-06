/**
 * API client. Handles token attachment, one-shot refresh on 401, and turns the
 * documented error envelope (API.md §0.2) into a typed exception.
 */

export type ApiErrorDetail = { field?: string; message: string };

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = '/api/v1';

const ACCESS_KEY = 'td_access_token';
const REFRESH_KEY = 'td_refresh_token';
const SESSION_KEY = 'td_session_id';
// A snapshot of the last `/auth/me` response, so a page load with no network
// (offline start, not a dead/expired token) can still know who's signed in
// instead of treating "can't reach the server" the same as "not logged in".
const USER_SNAPSHOT_KEY = 'td_user_snapshot';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  /** id of this browser's refresh-token row, so device management can flag "this device". */
  get session() {
    return localStorage.getItem(SESSION_KEY);
  },
  set(access: string, refresh: string, sessionId?: string | null) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_SNAPSHOT_KEY);
  },
  /** Persist the signed-in user so it survives a reload made with no network. */
  saveUserSnapshot(user: unknown) {
    try {
      localStorage.setItem(USER_SNAPSHOT_KEY, JSON.stringify(user));
    } catch {
      // Storage can be unavailable (private mode, quota); offline restore
      // just won't have a snapshot to use, which is a soft failure.
    }
  },
  /** Read back the last snapshot, or null if there isn't one / it's corrupt. */
  readUserSnapshot<T = unknown>(): T | null {
    try {
      const raw = localStorage.getItem(USER_SNAPSHOT_KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
};

/** Set by the app so a hard auth failure can bounce the user to /login. */
let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: () => void) {
  onAuthFailure = fn;
}

/**
 * Purge every Service Worker cache holding API responses.
 *
 * The runtime caches are keyed by URL only, with no notion of who was logged
 * in. Without this, signing in as a second teacher on the same browser can be
 * served the first teacher's rosters, phone numbers and scores out of the
 * StaleWhileRevalidate cache. Must run on logout and on any hard auth failure.
 */
export async function purgeApiCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('td-')).map((k) => caches.delete(k)),
    );
  } catch {
    // Storage can be unavailable (private mode, blocked site data); a failed
    // purge must not block the user from signing out.
  }
}

/**
 * Parse a response body as the documented JSON error envelope, tolerating a
 * body that isn't JSON at all — e.g. nginx's own HTML error page for a 413
 * (request too large) or 502/504, which never reaches the API's JSON error
 * handler. `JSON.parse` on that HTML would throw and mask the real HTTP
 * status behind a confusing syntax error.
 */
function parseJsonBody(text: string): { error?: { code?: string; message?: string; details?: ApiErrorDetail[] } } {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function describeNonJsonError(status: number): string {
  if (status === 413) return '文件过大，请压缩后重试';
  if (status === 502 || status === 503 || status === 504) return '服务暂时不可用，请稍后重试';
  return '请求失败';
}

/**
 * 'ok': refreshed. 'rejected': the server explicitly refused the refresh
 * token (expired/revoked/reused) — the session is genuinely over.
 * 'network-error': the request never got a server answer at all (offline, DNS,
 * tunnel down) — the refresh token itself might still be perfectly good, so
 * this must NOT be treated the same as 'rejected'.
 */
type RefreshOutcome = 'ok' | 'rejected' | 'network-error';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function refreshTokens(): Promise<RefreshOutcome> {
  const token = tokenStore.refresh;
  if (!token) return 'rejected';

  // Collapse concurrent 401s into a single refresh call; a second rotation
  // attempt with the same token would revoke the whole family server-side.
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        });
        if (!res.ok) return 'rejected';
        const body = await res.json();
        tokenStore.set(body.data.accessToken, body.data.refreshToken, body.data.sessionId);
        return 'ok';
      } catch {
        return 'network-error';
      } finally {
        // Reset synchronously: concurrent callers already hold this promise,
        // and leaving a settled one cached would make the NEXT 401 reuse a
        // stale success and skip logging the user out.
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  raw?: boolean;
  retrying?: boolean;
};

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {};
  const token = tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;
  // FormData sets its own multipart Content-Type (with boundary) — fetch does
  // this automatically only when the header isn't already set, and only when
  // it never got JSON.stringify'd, so FormData bodies pass through as-is.
  const isFormData = opts.body instanceof FormData;
  if (opts.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : isFormData ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }

  if (res.status === 401 && !opts.retrying && tokenStore.refresh) {
    const outcome = await refreshTokens();
    if (outcome === 'ok') {
      return request<T>(path, { ...opts, retrying: true });
    }
    if (outcome === 'network-error') {
      // Couldn't even reach the server to ask — this is not the server
      // saying the session is over, so don't wipe tokens or bounce to
      // /login; let the caller handle it as a plain connectivity failure.
      throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
    }
    tokenStore.clear();
    onAuthFailure?.();
    throw new ApiError(401, 'UNAUTHENTICATED', '登录已过期，请重新登录');
  }

  if (res.status === 204) return undefined as T;

  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'INTERNAL_ERROR', '导出失败');
    return (await res.blob()) as T;
  }

  const text = await res.text();
  const body = parseJsonBody(text);

  if (!res.ok) {
    const err = body.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'INTERNAL_ERROR',
      err.message ?? describeNonJsonError(res.status),
      err.details,
    );
  }

  return body as T;
}

/**
 * Fetch every page of a paginated list endpoint. `pageSize` is capped at 100
 * server-side (API.md §0.3), so a roster larger than that needs several calls.
 */
export async function fetchAllPages<T>(
  path: string,
  query: RequestOptions['query'] = {},
): Promise<T[]> {
  const pageSize = 100;
  const first = await request<{ data: T[]; meta: { totalPages: number } }>(path, {
    query: { ...query, page: 1, pageSize },
  });

  const out = [...first.data];
  for (let page = 2; page <= (first.meta?.totalPages ?? 1); page++) {
    const next = await request<{ data: T[] }>(path, { query: { ...query, page, pageSize } });
    out.push(...next.data);
  }
  return out;
}

/**
 * Upload a single file as multipart/form-data (Excel template imports).
 * Goes through `request()` (FormData-aware) so a stale access token gets the
 * same refresh-and-retry treatment as any other endpoint — an idle tab whose
 * token expired mid-session would otherwise fail every import/upload with a
 * hard 401 even though the refresh token is still good.
 */
function uploadFile<T = unknown>(
  path: string,
  file: File,
  query?: RequestOptions['query'],
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return request<T>(path, { method: 'POST', body: form, query });
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  blob: (path: string, query?: RequestOptions['query']) =>
    request<Blob>(path, { query, raw: true }),
  upload: uploadFile,
};
