<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchWeather, getCoords } from '@/api/weather';
import type { WeatherData } from '@/api/types';

const weather = ref<WeatherData | null>(null);

// WMO weather code → emoji. Buckets mirror lib/weather.ts on the server.
function emoji(code: number | null): string {
  if (code == null) return '🌡️';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

function round(n: number | null): string {
  return n == null ? '—' : `${Math.round(n)}°`;
}

onMounted(async () => {
  const coords = await getCoords();
  if (!coords) return; // no permission / unsupported → card stays hidden
  weather.value = await fetchWeather(coords.lat, coords.lon);
});
</script>

<template>
  <div v-if="weather" class="weather">
    <span class="w-icon">{{ emoji(weather.current.weatherCode) }}</span>
    <span class="w-temp">{{ round(weather.current.temp) }}</span>
    <span class="w-text">{{ weather.current.text }}</span>
    <span class="w-sep">·</span>
    <span v-for="(d, i) in weather.days.slice(0, 2)" :key="d.date" class="w-day">
      {{ i === 0 ? '今' : '明' }} {{ emoji(d.weatherCode) }}
      {{ round(d.tempMin) }}/{{ round(d.tempMax) }}
      <template v-if="d.precipProb != null && d.precipProb >= 30">
        ☔{{ d.precipProb }}%
      </template>
    </span>
  </div>
</template>

<style scoped>
.weather {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.w-icon { font-size: 18px; line-height: 1; }
.w-temp { font-size: 15px; font-weight: 600; color: var(--text); }
.w-text { color: var(--text); }
.w-sep { color: var(--text-faint); }
.w-day { white-space: nowrap; }
</style>
