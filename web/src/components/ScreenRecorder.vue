<script setup lang="ts">
/**
 * Records the screen/window the user picks (browser's own share-picker —
 * getDisplayMedia cannot be aimed at a specific element cross-origin, since
 * the GeoGebra applet lives in its own iframe) as a downloadable video. Used
 * for "Demo 录制" of a GeoGebra classroom demonstration.
 *
 * Output format follows whatever MediaRecorder the browser supports (webm on
 * Chrome/Firefox; mp4 only where the browser itself offers that mimeType) —
 * there is no server-side transcode.
 */
import { onBeforeUnmount, ref } from 'vue';

const recording = ref(false);
const error = ref('');
const videoUrl = ref('');
const elapsedSec = ref(0);

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

async function start() {
  error.value = '';
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value);
    videoUrl.value = '';
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    error.value = '当前浏览器不支持屏幕录制';
    return;
  }

  try {
    // Browser shows its own picker (window/tab/screen) — cannot be
    // pre-selected or skipped; that's a browser security boundary, not
    // something this app can configure around.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    // User cancelled the picker, or permission was denied — not an app error.
    return;
  }

  const mimeType = pickMimeType();
  chunks = [];
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    videoUrl.value = URL.createObjectURL(blob);
  };

  // The share picker itself has a native "Stop sharing" control that ends the
  // track without going through our stop() button — keep state in sync.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => stop());

  recorder.start();
  recording.value = true;
  elapsedSec.value = 0;
  timer = setInterval(() => (elapsedSec.value += 1), 1000);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recording.value = false;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

onBeforeUnmount(() => {
  stop();
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
});
</script>

<template>
  <div class="recorder card">
    <div class="row">
      <button v-if="!recording" class="btn btn-primary" @click="start">🔴 开始录制</button>
      <button v-else class="btn btn-danger" @click="stop">⏹ 停止录制（{{ formatTime(elapsedSec) }}）</button>
      <span v-if="recording" class="hint">请在弹出的浏览器窗口中选择要共享的标签页/窗口</span>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <div v-if="videoUrl" class="result">
      <video :src="videoUrl" controls class="preview" />
      <a :href="videoUrl" download="geogebra-demo.webm" class="btn btn-sm">下载录制视频</a>
    </div>
  </div>
</template>

<style scoped>
.recorder { display: flex; flex-direction: column; gap: 10px; }
.result { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.preview { width: 100%; max-width: 480px; border-radius: var(--radius-sm); background: #000; }
</style>
