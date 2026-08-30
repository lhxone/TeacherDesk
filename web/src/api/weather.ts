import { api } from './client';
import type { Envelope, WeatherData } from './types';

const COORDS_KEY = 'td_coords';
const COORDS_TTL_MS = 7 * 24 * 60 * 60_000;

type Coords = { lat: number; lon: number };

function readCached(): Coords | null {
  try {
    const raw = localStorage.getItem(COORDS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { lat: number; lon: number; at: number };
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return null;
    if (Date.now() - v.at > COORDS_TTL_MS) return null;
    return { lat: v.lat, lon: v.lon };
  } catch {
    return null;
  }
}

function writeCached(c: Coords): void {
  try {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ ...c, at: Date.now() }));
  } catch {
    // Storage unavailable (private mode) — just skip the cache.
  }
}

/**
 * Best-effort geolocation. Returns null (no error thrown) when the browser has
 * no geolocation, the user declined, or the lookup timed out — the caller hides
 * the weather card in that case.
 */
export function getCoords(): Promise<Coords | null> {
  const cached = readCached();
  if (cached) return Promise.resolve(cached);

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        writeCached(c);
        resolve(c);
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 60 * 60_000 },
    );
  });
}

export function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  return api
    .get<Envelope<WeatherData | null>>('/weather', { lat, lon })
    .then((r) => r.data)
    .catch(() => null);
}
