import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, resetDb, registerUser, prisma, type TestUser } from './helpers.js';

let app: FastifyInstance;
let user: TestUser;

const OPEN_METEO_SAMPLE = {
  current: { temperature_2m: 21.4, weather_code: 3, wind_speed_10m: 8.1 },
  daily: {
    time: ['2026-09-14', '2026-09-15'],
    weather_code: [3, 61],
    temperature_2m_max: [26, 24],
    temperature_2m_min: [18, 17],
    precipitation_probability_max: [10, 80],
  },
};

beforeEach(async () => {
  await resetDb();
  app = await createTestApp();
  user = await registerUser(app);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /weather', () => {
  it('normalises an Open-Meteo forecast into today + tomorrow', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(OPEN_METEO_SAMPLE), { status: 200 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/weather?lat=31.23&lon=121.47',
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.current.temp).toBe(21.4);
    expect(d.current.text).toBe('阴');
    expect(d.days).toHaveLength(2);
    expect(d.days[1]).toMatchObject({ text: '小雨', tempMax: 24, precipProb: 80 });
  });

  it('returns data:null (not 5xx) when the upstream fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/weather?lat=10&lon=10',
      headers: user.auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/weather?lat=200&lon=10',
      headers: user.auth,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/weather?lat=10&lon=10' });
    expect(res.statusCode).toBe(401);
  });
});
