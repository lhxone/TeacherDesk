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

let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const token = tokenStore.refresh;
  if (!token) return false;

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
        if (!res.ok) return false;
        const body = await res.json();
        tokenStore.set(body.data.accessToken, body.data.refreshToken, body.data.sessionId);
        return true;
      } catch {
        return false;
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
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }

  if (res.status === 401 && !opts.retrying && tokenStore.refresh) {
    if (await refreshTokens()) {
      return request<T>(path, { ...opts, retrying: true });
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
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const err = body.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'INTERNAL_ERROR',
      err.message ?? '请求失败',
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
 * Bypasses `request()`'s JSON body handling since fetch must set its own
 * multipart boundary in the Content-Type header.
 */
async function uploadFile<T = unknown>(
  path: string,
  file: File,
  query?: RequestOptions['query'],
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  const token = tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const err = body.error ?? {};
    throw new ApiError(res.status, err.code ?? 'INTERNAL_ERROR', err.message ?? '请求失败', err.details);
  }

  return body as T;
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
