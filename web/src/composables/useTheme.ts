import { ref, watchEffect } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-mode';

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

// Module-level singleton so every component sees the same reactive state
// without needing a Pinia store.
const mode = ref<ThemeMode>(readStored());
const media = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
media.addEventListener('change', (e) => {
  systemDark.value = e.matches;
});

function applyTheme() {
  const isDark = mode.value === 'dark' || (mode.value === 'system' && systemDark.value);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

watchEffect(applyTheme);

export function useTheme() {
  function setMode(next: ThemeMode) {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
  }

  return { mode, setMode };
}
