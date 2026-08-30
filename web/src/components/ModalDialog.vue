<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog" :class="{ wide: props.wide }" role="dialog" aria-modal="true">
      <header class="dialog-head">
        <h2>{{ title }}</h2>
        <button class="close" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <div class="dialog-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="dialog-foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}

.dialog {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 460px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog.wide { max-width: 760px; }

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.dialog-head h2 { font-size: 16px; }

.close {
  border: none;
  background: none;
  font-size: 24px;
  line-height: 1;
  color: var(--text-muted);
  padding: 0 4px;
}

.dialog-body { padding: 18px; overflow-y: auto; }

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}
</style>
