<script setup lang="ts">
/**
 * Wraps the official GeoGebra applet (deployggb.js from geogebra.org's CDN)
 * for classroom use: read-only preview of an uploaded .ggb file, or live
 * editing on top of one / a blank canvas.
 *
 * The applet is loaded from a Blob (via `base64`), not `filename` pointed at
 * our download URL — that endpoint requires an Authorization header the
 * applet's own fetch would never attach (see api/ggb.ts fetchBlob() for the
 * same reasoning as resources.ts download()).
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

declare global {
  interface Window {
    GGBApplet?: new (params: Record<string, unknown>, version: string) => GgbAppletInstance;
  }
}

/** The subset of the GeoGebra JS API this component actually calls. */
interface GgbAppletInstance {
  inject(containerId: string): void;
  getBase64(callback: (base64: string) => void): void;
  getBase64(): string;
  getPNGBase64(exportScale: number, transparent: boolean, dpi: number): string;
  setBase64(base64: string, callback?: () => void): void;
  setPerspective(perspective: string): void;
  remove?(): void;
}

const props = defineProps<{
  /** Base64-encoded .ggb file content to open; omit for a blank canvas. */
  base64?: string;
  /** false = 只读展示 (no toolbar, no editing); true = 现场编辑. */
  editable: boolean;
  height?: string;
}>();

const emit = defineEmits<{ ready: [] }>();

const containerId = `ggb-applet-${Math.random().toString(36).slice(2)}`;
const el = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref('');

let applet: GgbAppletInstance | null = null;
let scriptPromise: Promise<void> | null = null;
let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;

const DEPLOY_SCRIPT_URL = 'https://www.geogebra.org/apps/deployggb.js';
// GeoGebra's own parser can hang indefinitely — never surface an error itself
// — on a .ggb whose internal XML is malformed or missing fields a real
// GeoGebra export always has (seen with AI-generated .ggb content: it *looks*
// like valid XML but isn't a legitimate GeoGebra construction). Without this,
// such a file leaves the teacher staring at "GeoGebra 加载中…" forever with no
// way to tell "still loading" from "never going to load".
const LOAD_TIMEOUT_MS = 20_000;

function loadScript(): Promise<void> {
  if (window.GGBApplet) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${DEPLOY_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('load failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = DEPLOY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function mountApplet() {
  if (!window.GGBApplet || !el.value) return;

  // el.value must have a real on-screen size before we measure it below —
  // GeoGebra bakes width/height into its DOM at construction time and has no
  // working responsive/fluid resize afterwards (its setSize() call updates
  // internal state but not the actual rendered size — checked against the
  // live applet, not just docs). The one-time root cause of "canvas stuck at
  // a fallback size" was el.value being `v-show`-hidden (display:none, so
  // clientWidth/Height read 0) at measurement time — fixed by never hiding
  // that element (see the template). This wait is now just defense-in-depth
  // for the fullscreen stage's flex layout settling a tick after v-if flips
  // it on, in case el.value briefly has a real-but-wrong size.
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!el.value) return; // could have been unmounted while we were waiting

  // The applet is always constructed blank (never passed `ggbBase64` here —
  // not even omitted-via-undefined quite does it, the classic app otherwise
  // still attempts an internal "restore last file" load and surfaces a
  // "LoadFileFailed" toast even though the canvas works fine) and any actual
  // file content is loaded afterwards via setBase64() in appletOnLoad below.
  // This is what makes `perspective: 'G'` (graphics-only, no algebra panel)
  // actually take effect for 展示 mode: GeoGebra's own docs say that
  // construction param "shouldn't be used with ggbBase64", and passing both
  // together does exactly that — silently ignoring perspective (confirmed
  // against the live applet). Calling setPerspective('G') at runtime instead,
  // after loading a file the normal way, does not work either — that call is
  // a no-op at the exact moment appletOnLoad fires, for reasons still
  // unresolved even after long delays. Never combining ggbBase64 with a
  // perspective param sidesteps needing that at all.
  const params: Record<string, unknown> = {
    // Not 'classic': deployggb.js's own codebase-selection logic (see its
    // source — there is no supported "force full codebase" flag; a
    // documented `html5NoWebSimple` param exists in older references but the
    // live deployggb.js no longer checks it) swaps in the lightweight
    // "webSimple" codebase whenever showToolBar/showMenuBar/showAlgebraInput/
    // enableRightClick are ALL false AND appName is 'classic' (or unset) —
    // exactly our read-only 展示 mode's config. webSimple silently drops
    // support for sliders/animation: loading a real construction that uses
    // them there doesn't error, it just hangs forever (appletOnLoad never
    // fires, so the "加载中" spinner never clears — this bit us on an actual
    // 反比例函数 demo with a slider). 'geometry' is excluded from that
    // condition by name alone, so it always gets the full "web3d" codebase,
    // and it's arguably the better fit for classroom display anyway (no
    // CAS/spreadsheet chrome to strip).
    appName: 'geometry',
    width: el.value.clientWidth || 800,
    height: el.value.clientHeight || 500,
    showToolBar: props.editable,
    showAlgebraInput: props.editable,
    showMenuBar: false,
    showResetIcon: props.editable,
    enableRightClick: props.editable,
    enableShiftDragZoom: true,
    showZoomButtons: true,
    // appletOnLoad receives the fully-ready API object as its argument — the
    // "applet" the `new GGBApplet(...)` constructor returns (what `applet`
    // below holds until this fires) is only a launcher, not the live API
    // surface: calling API methods on it either silently no-ops
    // (setPerspective, in an earlier version of this file) or throws "not a
    // function" (setBase64, ditto). window.ggbApplet is a third alias to the
    // same ready object but is unsafe with more than one applet on a page —
    // the callback argument is the one GeoGebra's own docs recommend, and the
    // only one confirmed to actually work for both those calls.
    appletOnLoad: (api: GgbAppletInstance) => {
      applet = api;

      const finish = () => {
        // Graphics-only in 展示 mode — no algebra panel eating half the
        // canvas. Must run *after* the construction is loaded (setBase64
        // above, or the blank canvas already showing): the construction-time
        // `perspective` param does not achieve this — GeoGebra's docs say not
        // to combine it with a file anyway, but even set alone on a blank
        // canvas it doesn't stick after setBase64 later replaces the
        // construction. Edit mode keeps the default (graphics + algebra)
        // since a teacher editing live needs to see/change the formulas.
        if (!props.editable) api.setPerspective('G');
        if (loadTimeoutId) {
          clearTimeout(loadTimeoutId);
          loadTimeoutId = null;
        }
        loading.value = false;
        emit('ready');
        observeResize();
      };

      if (!props.base64) {
        finish(); // Blank canvas: nothing further to load, the applet is already showing it.
      } else {
        api.setBase64(props.base64, finish);
      }
    },
  };

  // This "launcher" object only knows inject() — appletOnLoad above
  // overwrites `applet` with the real, fully-functional API object once
  // it's actually ready.
  applet = new window.GGBApplet(params, '6.0');
  applet.inject(containerId);

  loadTimeoutId = setTimeout(() => {
    loadTimeoutId = null;
    if (!loading.value) return; // the load callback already fired first — nothing to do.
    loading.value = false;
    error.value = props.base64
      ? '文件加载超时，可能不是有效的 GeoGebra 文件，请用 GeoGebra 官方软件/网站打开并重新保存后再上传'
      : 'GeoGebra 加载超时，请检查网络连接后重试';
  }, LOAD_TIMEOUT_MS);
}

/**
 * GeoGebra takes a fixed pixel width/height at construction time and has no
 * working responsive resize after that — its own setSize() call updates
 * internal state but does not actually resize the rendered DOM (checked
 * against the live applet). So a genuine later resize (the user resizing the
 * browser window, or the sidebar collapsing) is handled the only way that
 * reliably works: tear down and reconstruct the applet at the new size,
 * debounced so a drag-resize doesn't thrash it.
 */
function observeResize() {
  if (!el.value) return;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // ResizeObserver fires once immediately on observe() with the current size
  // — that first call must be ignored, or every load would immediately tear
  // itself down and rebuild once for no reason.
  let firstCall = true;
  resizeObserver = new ResizeObserver((entries) => {
    if (firstCall) {
      firstCall = false;
      return;
    }
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    if (width <= 0 || height <= 0) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      applet?.remove?.();
      applet = null;
      loading.value = true;
      error.value = '';
      void mountApplet();
    }, 400);
  });
  resizeObserver.observe(el.value);
}

function stopObservingResize() {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

async function init() {
  loading.value = true;
  error.value = '';
  try {
    await loadScript();
    void mountApplet();
  } catch {
    loading.value = false;
    error.value = 'GeoGebra 加载失败，请检查网络连接';
  }
}

onMounted(init);

// A different file (or switching preview<->edit) needs a fresh applet
// instance — GeoGebra has no supported "swap file in place" API call.
watch(() => [props.base64, props.editable], () => {
  applet?.remove?.();
  applet = null;
  stopObservingResize();
  if (loadTimeoutId) {
    clearTimeout(loadTimeoutId);
    loadTimeoutId = null;
  }
  if (window.GGBApplet) {
    loading.value = true;
    error.value = '';
    void mountApplet();
  }
});

onBeforeUnmount(() => {
  applet?.remove?.();
  applet = null;
  stopObservingResize();
  if (loadTimeoutId) clearTimeout(loadTimeoutId);
});

defineExpose({
  /** Current construction as a base64-encoded .ggb file, for saving. */
  getBase64: (): Promise<string> =>
    new Promise((resolve) => {
      if (!applet) return resolve('');
      applet.getBase64((base64) => resolve(base64));
    }),
  /** Current view as a PNG data URL, for a quick export/screenshot. */
  getPngDataUrl: (): string =>
    applet ? `data:image/png;base64,${applet.getPNGBase64(1, false, 72)}` : '',
});
</script>

<template>
  <div class="ggb-wrap" :style="{ height: height ?? '520px' }">
    <div v-if="loading" class="ggb-status hint">
      <p>GeoGebra 加载中…</p>
      <p class="ggb-status-sub">
        首次加载需要从 GeoGebra 官方下载画板资源，视网络情况可能需要几十秒；
        加载完成后会被浏览器缓存，之后再打开会快很多
      </p>
    </div>
    <p v-else-if="error" class="ggb-status error-text">{{ error }}</p>
    <!--
      Always rendered, never v-show/v-if hidden: mountApplet() measures this
      element's clientWidth/clientHeight to size the applet, and a
      display:none element (what v-show toggles) always reports 0×0 — which
      silently fell back to a hardcoded 800×500, the actual cause of the
      "canvas only fills a corner of the fullscreen stage" bug (not a mount
      timing issue, despite what an earlier version of this comment guessed).
      The loading/error overlays are position:absolute so they can sit on top
      of this instead.
    -->
    <div :id="containerId" ref="el" class="ggb-canvas" />
  </div>
</template>

<style scoped>
.ggb-wrap {
  position: relative;
  width: 100%;
  background: var(--surface);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ggb-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  padding: 0 24px;
}

.ggb-status-sub {
  font-size: 12px;
  color: var(--text-faint);
  max-width: 360px;
}

.ggb-canvas { width: 100%; height: 100%; }
</style>
