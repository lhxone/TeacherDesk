/**
 * Weather proxy for the home page. Fetches a 2-day forecast from Open-Meteo
 * (free, no API key) for a lat/lon and normalises it.
 *
 * Design notes:
 *  - Results are cached in-process for 30 min per rounded coordinate, so a
 *    classroom of refreshes hits the upstream once.
 *  - Any upstream failure (offline server, non-200, timeout) resolves to
 *    `{ data: null }`, never a 5xx — the client hides the card silently.
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../app.js';
import { weatherText } from '../lib/weather.js';

const CACHE_TTL_MS = 30 * 60_000;
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

type Day = {
  date: string;
  weatherCode: number | null;
  text: string;
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null;
};

export type WeatherData = {
  current: { temp: number | null; weatherCode: number | null; text: string; windSpeed: number | null };
  days: Day[];
};

const cache = new Map<string, { at: number; data: WeatherData | null }>();

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

async function fetchForecast(lat: number, lon: number): Promise<WeatherData | null> {
  const url =
    `${OPEN_METEO}?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=2';

  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;

  const j = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: (number | null)[];
    };
  };

  const d = j.daily ?? {};
  const times = d.time ?? [];
  const days: Day[] = times.slice(0, 2).map((date, i) => {
    const code = d.weather_code?.[i] ?? null;
    return {
      date,
      weatherCode: code,
      text: weatherText(code),
      tempMax: d.temperature_2m_max?.[i] ?? null,
      tempMin: d.temperature_2m_min?.[i] ?? null,
      precipProb: d.precipitation_probability_max?.[i] ?? null,
    };
  });

  const cur = j.current ?? {};
  return {
    current: {
      temp: cur.temperature_2m ?? null,
      weatherCode: cur.weather_code ?? null,
      text: weatherText(cur.weather_code),
      windSpeed: cur.wind_speed_10m ?? null,
    },
    days,
  };
}

export async function registerWeatherRoutes(app: FastifyInstance) {
  app.get('/weather', async (req) => {
    requireUser(req);
    const { lat, lon } = querySchema.parse(req.query);
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { data: hit.data };
    }

    let data: WeatherData | null = null;
    try {
      data = await fetchForecast(lat, lon);
    } catch (err) {
      req.log.warn({ err }, 'weather fetch failed');
    }

    // Cache even a null so a flaky upstream isn't hammered for 30 min.
    cache.set(key, { at: Date.now(), data });
    return { data };
  });
}
