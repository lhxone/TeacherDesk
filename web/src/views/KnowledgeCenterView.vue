<script setup lang="ts">
/**
 * Knowledge Center, Explorer-style: the left pane is an expand/collapse
 * folder tree (ResourceCollectionTree), and the main pane shows the current
 * folder's contents — subfolders and files mixed in one grid/list, exactly
 * like Windows Explorer's right pane. Double-click a folder to enter it,
 * double-click a file to open its detail/preview. Type/favorite/recent/
 * knowledge-point/tag browsing all live as filters on top of "current
 * folder" rather than as separate top-level sections — see `filterMode`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import { knowledgeNodesApi, resourceCollectionsApi, resourcesApi } from '@/api/resources';
import type { Envelope, KnowledgeNode, Resource, ResourceCollection, ResourceType, Tag } from '@/api/types';
import { RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '@/api/types';
import ModalDialog from '@/components/ModalDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import UploadDialog from '@/components/UploadDialog.vue';
import KnowledgeTreeManager from '@/components/KnowledgeTreeManager.vue';
import ResourceCollectionTree from '@/components/ResourceCollectionTree.vue';
import CollectionPicker from '@/components/CollectionPicker.vue';
import GgbApplet from '@/components/GgbApplet.vue';

type ViewMode = 'grid' | 'list';
/** A filter narrows the current folder's file listing; it never changes which folder is "open". */
type FilterMode = 'none' | ResourceType | 'favorite';

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: 'none', label: '全部类型' },
  { key: 'textbook', label: '教材' },
  { key: 'ppt', label: 'PPT' },
  { key: 'lesson_plan', label: '教案' },
  { key: 'image', label: '图片' },
  { key: 'geogebra', label: 'GeoGebra' },
  { key: 'mistake', label: '错题' },
  { key: 'document', label: '文档' },
  { key: 'other', label: '其他' },
  { key: 'favorite', label: '⭐ 收藏' },
];

// The current folder being browsed (null = root / 全部文件夹). Independent of
// filters: switching a type/tag/knowledge-point filter narrows the listing
// within this folder, it never navigates away from it.
const activeCollectionId = ref<string | null>(null);
const filterMode = ref<FilterMode>('none');
const activeTagId = ref<string | null>(null);
const activeKnowledgeNodeId = ref<string | null>(null);
// 'browse' = normal Explorer view; 'knowledge'/'tags' swap the main pane for
// their management UI (same as before), independent of the folder tree.
const mainPane = ref<'browse' | 'knowledge' | 'tags'>('browse');

// Mobile only: the full folder tree (ResourceCollectionTree) collapses into
// this bottom sheet instead of taking a permanent chunk of vertical space —
// see the "current location" pill in the mobile nav strip below.
const showMobileFolderSheet = ref(false);

const resources = ref<Resource[]>([]);
const loading = ref(false);
const searchTerm = ref('');

// Persist the teacher's preferred grid/list layout across visits — a purely
// cosmetic per-browser preference, not data worth syncing server-side.
const viewMode = ref<ViewMode>((localStorage.getItem('kc-view-mode') as ViewMode) || 'grid');
watch(viewMode, (v) => localStorage.setItem('kc-view-mode', v));

const tags = ref<Tag[]>([]);
const knowledgeNodes = ref<KnowledgeNode[]>([]);
const collections = ref<ResourceCollection[]>([]);

const collectionsById = computed(() => new Map(collections.value.map((c) => [c.id, c])));
const byParentId = computed(() => {
  const map = new Map<string | null, ResourceCollection[]>();
  for (const c of collections.value) {
    const key = c.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return map;
});

/** Subfolders of the folder currently open, shown alongside its files — hidden while a search is active (search is flat/global). */
const childFolders = computed(() =>
  searchTerm.value.trim() ? [] : byParentId.value.get(activeCollectionId.value) ?? [],
);

/** Root-to-current chain of folders, for the breadcrumb bar. */
const collectionBreadcrumb = computed(() => {
  const chain: ResourceCollection[] = [];
  let cur = activeCollectionId.value ? collectionsById.value.get(activeCollectionId.value) ?? null : null;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? collectionsById.value.get(cur.parentId) ?? null : null;
  }
  return chain;
});

const currentFolderLabel = computed(() =>
  collectionBreadcrumb.value.length
    ? `文件夹 / ${collectionBreadcrumb.value.map((c) => c.name).join(' / ')}`
    : '全部文件夹',
);

/** Just the current folder's own name (or root label) — for the compact mobile nav pill, where the full breadcrumb would overflow. */
const currentFolderShortLabel = computed(() =>
  collectionBreadcrumb.value.length ? collectionBreadcrumb.value[collectionBreadcrumb.value.length - 1].name : '全部文件夹',
);

const showUpload = ref(false);
const detail = ref<Resource | null>(null);

// Preview panel state. Only one of these is populated at a time, depending
// on detail.type/mimeType — see loadPreview(). Image/PDF/PPT/Word are all
// fetched as an authenticated Blob (a plain <img>/<iframe src="/api/...">
// can't carry the Authorization header a bare browser request needs, same
// reason resourcesApi.download() can't just be a link — see its comment).
// Word and PPT both render into a container div via a layout-accurate pure-JS
// renderer (docx-preview / pptx-preview) rather than converting to flattened
// HTML — see docx-preview's rationale in loadPreview() below.
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const previewImageUrl = ref<string | null>(null);
const previewPdfUrl = ref<string | null>(null);
const docxContainer = ref<HTMLElement | null>(null);
const pptxContainer = ref<HTMLElement | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pptxPreviewer: any = null;
// GeoGebra preview: base64 content handed to GgbApplet (read-only), same
// approach as the classroom tools page — see ToolsView.vue's comment on why
// it's base64 and not `filename` pointed at the download URL.
const previewGgbBase64 = ref<string | null>(null);

function clearPreview() {
  if (previewImageUrl.value) URL.revokeObjectURL(previewImageUrl.value);
  if (previewPdfUrl.value) URL.revokeObjectURL(previewPdfUrl.value);
  previewImageUrl.value = null;
  previewPdfUrl.value = null;
  previewGgbBase64.value = null;
  previewError.value = null;
  if (docxContainer.value) docxContainer.value.innerHTML = '';
  pptxPreviewer?.destroy?.();
  pptxPreviewer = null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** docx via .docx extension OR the OOXML wordprocessingml mimetype (mirrors the backend's own check). */
function isDocx(r: Resource): boolean {
  return r.originalFilename.toLowerCase().endsWith('.docx') || r.mimeType.includes('wordprocessingml');
}
function isPptx(r: Resource): boolean {
  return r.originalFilename.toLowerCase().endsWith('.pptx') || r.mimeType.includes('presentationml');
}

async function loadPreview(r: Resource) {
  clearPreview();
  if (r.type === 'geogebra') {
    previewLoading.value = true;
    try {
      const blob = await api.blob(`/resources/${r.id}/download`);
      previewGgbBase64.value = await blobToBase64(blob);
    } catch {
      previewError.value = '预览加载失败';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  if (r.type === 'image') {
    previewLoading.value = true;
    try {
      const blob = await api.blob(`/resources/${r.id}/download`);
      previewImageUrl.value = URL.createObjectURL(blob);
    } catch {
      previewError.value = '预览加载失败';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  if (r.mimeType === 'application/pdf' || r.originalFilename.toLowerCase().endsWith('.pdf')) {
    previewLoading.value = true;
    try {
      const blob = await api.blob(`/resources/${r.id}/download`);
      previewPdfUrl.value = URL.createObjectURL(blob);
    } catch {
      previewError.value = '预览加载失败';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  if (isDocx(r)) {
    previewLoading.value = true;
    try {
      const blob = await api.blob(`/resources/${r.id}/download`);
      await nextTick();
      if (!docxContainer.value) return;
      // docx-preview parses the OOXML shape/column/table layout itself and
      // renders it into the container, instead of mammoth's approach of
      // flattening to semantic HTML (headings/paragraphs only) — the latter
      // loses multi-column layouts, text boxes and absolute positioning on
      // anything but a simple document. Mirrors the pptx-preview approach
      // below, kept as a dynamic import for the same code-splitting reason.
      const { renderAsync } = await import('docx-preview');
      await renderAsync(blob, docxContainer.value, undefined, { inWrapper: false });
    } catch {
      previewError.value = '预览加载失败';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  if (isPptx(r)) {
    previewLoading.value = true;
    try {
      const blob = await api.blob(`/resources/${r.id}/download`);
      const buffer = await blob.arrayBuffer();
      await nextTick();
      if (!pptxContainer.value) return;
      const { init } = await import('pptx-preview');
      pptxPreviewer = init(pptxContainer.value, { width: 640, height: 360 });
      await pptxPreviewer.preview(buffer);
    } catch {
      previewError.value = '预览加载失败（该 PPT 可能格式不受支持）';
    } finally {
      previewLoading.value = false;
    }
  }
}

watch(detail, (r) => {
  if (r) loadPreview(r);
  else clearPreview();
});

onBeforeUnmount(clearPreview);

// Bumped on every loadResources() call so a response that resolves after a
// newer request was already issued (e.g. clicking two folders in quick
// succession) can recognize it's stale and get discarded instead of
// clobbering `resources` with the wrong folder's contents.
let resourcesRequestId = 0;

async function loadResources() {
  const requestId = ++resourcesRequestId;
  loading.value = true;
  try {
    const query: Record<string, string | number | boolean | undefined> = { pageSize: 100 };
    if (searchTerm.value.trim()) {
      // Search is flat/global — it ignores "current folder" the same way
      // Explorer's search box searches the whole tree, not just one folder.
      query.q = searchTerm.value.trim();
    } else if (activeCollectionId.value) {
      query.collectionId = activeCollectionId.value;
    }
    if (filterMode.value === 'favorite') query.favorite = true;
    else if (filterMode.value !== 'none') query.type = filterMode.value;
    if (activeTagId.value) query.tagId = activeTagId.value;
    if (activeKnowledgeNodeId.value) query.knowledgeNodeId = activeKnowledgeNodeId.value;

    const res = await resourcesApi.list(query);
    if (requestId !== resourcesRequestId) return; // a newer navigation already superseded this one
    resources.value = res.data;
  } finally {
    if (requestId === resourcesRequestId) loading.value = false;
  }
}

async function loadTags() {
  const res = await api.get<Envelope<Tag[]>>('/tags');
  tags.value = res.data;
}

async function loadKnowledgeNodes() {
  const res = await knowledgeNodesApi.list();
  knowledgeNodes.value = res.data;
}

async function loadCollections() {
  const res = await resourceCollectionsApi.list();
  collections.value = res.data;
}

/** Navigate into a folder (Explorer-style: this is "current directory", not a filter). */
function openCollection(collectionId: string | null) {
  mainPane.value = 'browse';
  activeCollectionId.value = collectionId;
  searchTerm.value = '';
  loadResources();
}

function selectTag(tagId: string) {
  mainPane.value = 'browse';
  activeTagId.value = tagId;
  activeKnowledgeNodeId.value = null;
  loadResources();
}

function selectKnowledgeNode(nodeId: string) {
  mainPane.value = 'browse';
  activeKnowledgeNodeId.value = nodeId;
  activeTagId.value = null;
  loadResources();
}

function clearTagAndKnowledgeFilters() {
  activeTagId.value = null;
  activeKnowledgeNodeId.value = null;
  loadResources();
}

watch(filterMode, loadResources);

/** Move a resource into a folder (or out of any folder, with `null`) via the detail modal's picker. */
async function moveToCollection(r: Resource, collectionId: string | null) {
  const res = await resourcesApi.update(r.id, { collectionId });
  if (detail.value?.id === r.id) detail.value = res.data;
  await loadCollections();
  // Refresh the listing — the moved resource may need to disappear from (or
  // now belongs in) the folder currently open.
  await loadResources();
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined;
watch(searchTerm, () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadResources, 300);
});

async function openDetail(r: Resource) {
  const res = await resourcesApi.get(r.id);
  detail.value = res.data;
  resourcesApi.touch(r.id).catch(() => {});
}

async function toggleFavorite(r: Resource) {
  const res = await resourcesApi.update(r.id, { isFavorite: !r.isFavorite });
  resources.value = resources.value.map((x) => (x.id === r.id ? res.data : x));
  if (detail.value?.id === r.id) detail.value = res.data;
}

async function openFile(r: Resource) {
  await resourcesApi.touch(r.id);
  await resourcesApi.download(r.id, r.originalFilename);
}

async function removeResource(r: Resource) {
  if (!confirm(`确定删除「${r.title}」吗？`)) return;
  await resourcesApi.remove(r.id);
  resources.value = resources.value.filter((x) => x.id !== r.id);
  if (detail.value?.id === r.id) detail.value = null;
}

async function retryParse(r: Resource) {
  await resourcesApi.retry(r.id);
  await loadResources();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short YYYY-MM-DD for the list view's "更新时间" column — full timestamps are more precision than a glance-and-scan table needs. */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

onMounted(() => {
  loadResources();
  loadTags();
  loadKnowledgeNodes();
  loadCollections();
});
</script>

<template>
  <div class="page kc-page">
    <header class="page-header">
      <h1>知识中心</h1>
      <div class="row">
        <input v-model="searchTerm" class="input" style="width: 220px" placeholder="搜索标题 / 文件名 / 内容（全局）" />
        <button class="btn btn-primary" @click="showUpload = true">+ 上传资源</button>
      </div>
    </header>

    <!-- Mobile: the sidebar collapses to one scrollable pill strip — a
         "current location" pill (opens the folder tree as a bottom sheet)
         plus the three fixed shortcuts, so it costs one row instead of the
         desktop sidebar's full column of vertical space. -->
    <div class="kc-nav-mobile-wrap hide-desktop">
      <div class="kc-nav-mobile">
        <button
          class="nav-pill"
          :class="{ active: mainPane === 'browse' && !activeTagId && !activeKnowledgeNodeId && filterMode !== 'favorite' }"
          @click="showMobileFolderSheet = true"
        >📁 {{ currentFolderShortLabel }}</button>
        <button class="nav-pill" :class="{ active: mainPane === 'knowledge' }" @click="mainPane = 'knowledge'">🎯 知识点</button>
        <button class="nav-pill" :class="{ active: mainPane === 'tags' }" @click="mainPane = 'tags'">🏷️ 标签</button>
        <button
          class="nav-pill"
          :class="{ active: mainPane === 'browse' && filterMode === 'favorite' && !activeCollectionId }"
          @click="mainPane = 'browse'; activeCollectionId = null; filterMode = 'favorite'; clearTagAndKnowledgeFilters()"
        >⭐ 收藏</button>
      </div>
      <!-- Fade hint that the strip scrolls further — without it a pill cut
           off at the viewport edge reads as broken/truncated rather than
           "swipe for more". Purely decorative, so it's not part of the
           scroll container and never blocks a touch/drag on the edge pill. -->
      <div class="kc-nav-mobile-fade" aria-hidden="true"></div>
    </div>

    <!-- Mobile folder-tree bottom sheet: same ResourceCollectionTree the
         desktop sidebar uses, just presented as a sheet instead of a
         permanently-visible column — see CollectionPicker's mobile layout
         for the same sheet-over-popover pattern. -->
    <div v-if="showMobileFolderSheet" class="sheet-backdrop hide-desktop" @click="showMobileFolderSheet = false"></div>
    <div v-if="showMobileFolderSheet" class="folder-sheet hide-desktop">
      <div class="folder-sheet-head">
        <h2>文件夹</h2>
        <button class="close" aria-label="关闭" @click="showMobileFolderSheet = false">×</button>
      </div>
      <div class="folder-sheet-body">
        <ResourceCollectionTree
          :collections="collections"
          :active-id="mainPane === 'browse' && !activeTagId && !activeKnowledgeNodeId ? activeCollectionId : null"
          @changed="loadCollections"
          @select="(id) => { openCollection(id); showMobileFolderSheet = false; }"
        />
      </div>
    </div>

    <div class="kc-layout">
      <aside class="kc-nav hide-mobile">
        <ResourceCollectionTree
          :collections="collections"
          :active-id="mainPane === 'browse' && !activeTagId && !activeKnowledgeNodeId ? activeCollectionId : null"
          @changed="loadCollections"
          @select="openCollection"
        />
        <div class="kc-nav-divider"></div>
        <button class="kc-nav-item" :class="{ active: mainPane === 'knowledge' }" @click="mainPane = 'knowledge'">🎯 知识点</button>
        <button class="kc-nav-item" :class="{ active: mainPane === 'tags' }" @click="mainPane = 'tags'">🏷️ 标签</button>
        <button
          class="kc-nav-item"
          :class="{ active: mainPane === 'browse' && filterMode === 'favorite' && !activeCollectionId }"
          @click="mainPane = 'browse'; activeCollectionId = null; filterMode = 'favorite'; clearTagAndKnowledgeFilters()"
        >⭐ 收藏</button>
      </aside>

      <main class="kc-content">
        <!-- 知识点 tree -->
        <div v-if="mainPane === 'knowledge'" class="stack">
          <KnowledgeTreeManager :nodes="knowledgeNodes" @changed="loadKnowledgeNodes" @select="selectKnowledgeNode" />
        </div>

        <!-- 标签 list -->
        <div v-else-if="mainPane === 'tags'" class="stack">
          <div v-if="!tags.length" class="empty-inline">还没有标签，先在资源详情里添加</div>
          <div v-else class="row">
            <button
              v-for="t in tags"
              :key="t.id"
              class="badge tag-pill"
              :style="{ background: t.color + '22', color: t.color }"
              @click="selectTag(t.id)"
            >
              {{ t.name }}
            </button>
          </div>
        </div>

        <!-- Explorer-style browse: breadcrumb + filters, folders and files mixed -->
        <template v-else>
          <!-- Desktop only: the mobile nav strip's "current location" pill
               already shows this, so a second copy here would be redundant
               on a screen tight on vertical space. -->
          <nav class="breadcrumb hide-mobile">
            <button class="crumb" @click="openCollection(null)">文件夹</button>
            <template v-for="c in collectionBreadcrumb" :key="c.id">
              <span class="crumb-sep">/</span>
              <button class="crumb" @click="openCollection(c.id)">{{ c.name }}</button>
            </template>
          </nav>

          <div class="row toolbar">
            <select v-model="filterMode" class="select" style="width: 140px">
              <option v-for="f in FILTER_OPTIONS" :key="f.key" :value="f.key">{{ f.label }}</option>
            </select>
            <span v-if="activeTagId || activeKnowledgeNodeId" class="badge active-filter-badge">
              {{ activeTagId ? '按标签筛选' : '按知识点筛选' }}
              <button class="clear-filter" @click="clearTagAndKnowledgeFilters">✕</button>
            </span>
            <div class="view-toggle" style="margin-left: auto">
              <button class="btn btn-sm" :class="{ active: viewMode === 'grid' }" title="平铺视图" @click="viewMode = 'grid'">▦</button>
              <button class="btn btn-sm" :class="{ active: viewMode === 'list' }" title="列表视图" @click="viewMode = 'list'">☰</button>
            </div>
          </div>

          <!-- Loading keeps the previous listing visible (just dimmed) instead of
               collapsing the content area to a single line — swapping folders/files
               out for a bare "加载中…" line and back made the page's height jump on
               every navigation, which shifted the whole centered .page sideways
               whenever it crossed the viewport's scrollbar threshold. -->
          <EmptyState v-if="!loading && !childFolders.length && !resources.length" icon="search" title="这里还没有内容">
            上传资源到当前文件夹，或点击左侧「+」新建子文件夹
          </EmptyState>

          <div v-else-if="viewMode === 'grid'" class="grid" :class="{ 'is-loading': loading }">
            <article
              v-for="f in childFolders"
              :key="f.id"
              class="card folder-card"
              @click="openCollection(f.id)"
            >
              <div class="folder-icon">📁</div>
              <h3 class="resource-title">{{ f.name }}</h3>
              <p class="hint">{{ f.resourceCount }} 个资源</p>
            </article>
            <article v-for="r in resources" :key="r.id" class="card resource-card" @click="openDetail(r)">
              <div class="resource-head">
                <span class="badge">{{ RESOURCE_TYPE_LABELS[r.type] }}</span>
                <span
                  v-if="r.status !== 'ready'"
                  class="badge"
                  :class="{ 'badge-warn': r.status === 'parsing' || r.status === 'pending', 'badge-danger': r.status === 'failed' }"
                >
                  {{ RESOURCE_STATUS_LABELS[r.status] }}
                </span>
                <button
                  class="fav-btn"
                  :class="{ active: r.isFavorite }"
                  title="收藏"
                  @click.stop="toggleFavorite(r)"
                >★</button>
              </div>
              <h3 class="resource-title">{{ r.title }}</h3>
              <p class="hint">{{ r.originalFilename }} · {{ formatSize(r.fileSize) }}</p>
              <p v-if="r.matchedChunk?.snippet" class="hint match-snippet">
                <template v-if="r.matchedChunk.pageNumber">第 {{ r.matchedChunk.pageNumber }} 页：</template>
                <template v-else-if="r.matchedChunk.sectionLabel">{{ r.matchedChunk.sectionLabel }}：</template>
                {{ r.matchedChunk.snippet }}
              </p>
              <div v-if="r.tags.length" class="row tags-row">
                <span v-for="t in r.tags" :key="t.id" class="badge" :style="{ background: t.color + '22', color: t.color }">
                  {{ t.name }}
                </span>
              </div>
            </article>
          </div>

          <!-- Desktop: a real table — enough width for every column, and the
               table's own overflow-x:auto only ever kicks in on a genuinely
               narrow desktop window, not as the normal case. -->
          <div v-else class="table-wrap hide-mobile" :class="{ 'is-loading': loading }">
            <table>
              <thead>
                <tr>
                  <th>名称</th><th>类型</th><th>学科 / 年级</th><th>标签</th><th>大小</th><th>更新时间</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in childFolders" :key="f.id" class="row-clickable" @click="openCollection(f.id)">
                  <td>📁 {{ f.name }}</td>
                  <td class="hint">文件夹</td>
                  <td class="hint">—</td>
                  <td class="hint">—</td>
                  <td class="hint">{{ f.resourceCount }} 个资源</td>
                  <td class="hint">—</td>
                  <td></td>
                </tr>
                <tr v-for="r in resources" :key="r.id" class="row-clickable" @click="openDetail(r)">
                  <td>
                    {{ r.title }}
                    <span
                      v-if="r.status !== 'ready'"
                      class="badge badge-sm"
                      :class="{ 'badge-warn': r.status === 'parsing' || r.status === 'pending', 'badge-danger': r.status === 'failed' }"
                    >{{ RESOURCE_STATUS_LABELS[r.status] }}</span>
                    <div class="hint filename-sub">{{ r.originalFilename }}</div>
                  </td>
                  <td><span class="badge">{{ RESOURCE_TYPE_LABELS[r.type] }}</span></td>
                  <td class="hint">{{ [r.subject, r.grade].filter(Boolean).join(' / ') || '—' }}</td>
                  <td>
                    <div v-if="r.tags.length" class="row tags-row">
                      <span v-for="t in r.tags" :key="t.id" class="badge" :style="{ background: t.color + '22', color: t.color }">
                        {{ t.name }}
                      </span>
                    </div>
                    <span v-else class="hint">—</span>
                  </td>
                  <td class="hint">{{ formatSize(r.fileSize) }}</td>
                  <td class="hint">{{ formatDate(r.updatedAt) }}</td>
                  <td>
                    <button class="fav-btn" :class="{ active: r.isFavorite }" title="收藏" @click.stop="toggleFavorite(r)">★</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile: a vertical card list instead of a horizontally-scrolling
               table — no side-scroll to conflict with (or be visually confused
               with) the nav strip's own horizontal scroll above. Each row's
               info collapses into 2-3 lines instead of spreading across
               columns that don't fit a phone's width. Rendered alongside the
               table above (not v-else — hide-mobile/hide-desktop pick one),
               since Vue only allows a single v-else per v-if chain. -->
          <div v-if="viewMode === 'list'" class="list-mobile hide-desktop" :class="{ 'is-loading': loading }">
            <div v-for="f in childFolders" :key="f.id" class="list-row" @click="openCollection(f.id)">
              <div class="list-row-main">
                <span class="list-row-title">📁 {{ f.name }}</span>
              </div>
              <div class="hint">{{ f.resourceCount }} 个资源</div>
            </div>
            <div v-for="r in resources" :key="r.id" class="list-row" @click="openDetail(r)">
              <div class="list-row-main">
                <span class="list-row-title">{{ r.title }}</span>
                <button class="fav-btn" :class="{ active: r.isFavorite }" title="收藏" @click.stop="toggleFavorite(r)">★</button>
              </div>
              <div class="hint">{{ r.originalFilename }}</div>
              <div class="row list-row-meta">
                <span class="badge">{{ RESOURCE_TYPE_LABELS[r.type] }}</span>
                <span
                  v-if="r.status !== 'ready'"
                  class="badge badge-sm"
                  :class="{ 'badge-warn': r.status === 'parsing' || r.status === 'pending', 'badge-danger': r.status === 'failed' }"
                >{{ RESOURCE_STATUS_LABELS[r.status] }}</span>
                <span v-if="r.subject || r.grade" class="hint">{{ [r.subject, r.grade].filter(Boolean).join(' / ') }}</span>
                <span class="hint">{{ formatSize(r.fileSize) }}</span>
                <span class="hint">{{ formatDate(r.updatedAt) }}</span>
              </div>
              <div v-if="r.tags.length" class="row tags-row">
                <span v-for="t in r.tags" :key="t.id" class="badge" :style="{ background: t.color + '22', color: t.color }">
                  {{ t.name }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- Upload modal: always targets the folder currently open, Explorer-style -->
    <UploadDialog
      v-if="showUpload"
      :tags="tags"
      :knowledge-nodes="knowledgeNodes"
      :target-collection-id="activeCollectionId"
      :target-collection-label="currentFolderLabel"
      @close="showUpload = false"
      @uploaded="() => { showUpload = false; loadResources(); loadCollections(); }"
    />

    <!-- Detail modal -->
    <ModalDialog v-if="detail" :title="detail.title" wide @close="detail = null">
      <div class="stack">
        <div class="row">
          <span class="badge">{{ RESOURCE_TYPE_LABELS[detail.type] }}</span>
          <span
            v-if="detail.status !== 'ready'"
            class="badge"
            :class="{ 'badge-warn': detail.status === 'parsing' || detail.status === 'pending', 'badge-danger': detail.status === 'failed' }"
          >
            {{ RESOURCE_STATUS_LABELS[detail.status] }}
          </span>
          <span class="hint">{{ detail.originalFilename }} · {{ formatSize(detail.fileSize) }}</span>
        </div>

        <p v-if="detail.status === 'failed'" class="error-text">
          解析失败：{{ detail.parseError }}
          <button class="btn btn-sm" @click="retryParse(detail)">重试解析</button>
        </p>

        <div v-if="detail.note" class="hint">{{ detail.note }}</div>

        <div class="field">
          <label>文件夹</label>
          <CollectionPicker
            :collections="collections"
            :model-value="detail.collection?.id ?? null"
            @update:model-value="(id) => moveToCollection(detail!, id)"
          />
        </div>

        <!-- Visual preview: image / PDF / Word / PPT. Renders nothing for
             types with no preview — e.g. plain text or a legacy .doc/.ppt
             this project can't parse (chunk text is still searchable, just
             not shown here — see docs/API.md's download endpoint note).
             Word/PPT containers stay in the DOM (v-show, not v-if/v-else)
             because loadPreview() needs the ref to already exist when its
             dynamically-imported renderer mounts into it after nextTick. -->
        <div v-if="previewLoading" class="empty-inline">预览加载中…</div>
        <p v-else-if="previewError" class="error-text">{{ previewError }}</p>
        <div v-else-if="previewGgbBase64" class="preview-panel preview-ggb">
          <GgbApplet :base64="previewGgbBase64" :editable="false" height="420px" />
        </div>
        <div v-else-if="previewImageUrl" class="preview-panel">
          <img :src="previewImageUrl" :alt="detail.title" class="preview-image" />
        </div>
        <div v-else-if="previewPdfUrl" class="preview-panel">
          <iframe :src="previewPdfUrl" class="preview-pdf" title="PDF 预览"></iframe>
        </div>
        <div v-show="!previewLoading && !previewError && isDocx(detail)" class="preview-panel preview-docx">
          <div ref="docxContainer"></div>
        </div>
        <div v-show="!previewLoading && !previewError && isPptx(detail)" class="preview-panel">
          <div ref="pptxContainer" class="preview-pptx"></div>
        </div>
      </div>

      <template #footer>
        <button class="btn btn-danger" @click="removeResource(detail)">删除</button>
        <button class="btn" @click="toggleFavorite(detail)">{{ detail.isFavorite ? '取消收藏' : '收藏' }}</button>
        <button class="btn btn-primary" @click="openFile(detail)">下载 / 打开</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.kc-layout { display: grid; grid-template-columns: 220px 1fr; gap: 20px; align-items: start; }

.kc-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 8px;
  background: var(--surface);
}
.kc-nav-divider { height: 1px; background: var(--border); margin: 8px 2px; }
.kc-nav-item {
  text-align: left;
  padding: 7px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-weight: 500;
  font-size: 13.5px;
}
.kc-nav-item:hover { background: var(--hover-tint); color: var(--text); }
.kc-nav-item.active { background: var(--brand-soft); color: var(--brand-dark); }

.breadcrumb { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.crumb { border: none; background: none; color: var(--text-muted); padding: 2px 4px; font-size: 14px; }
.crumb:hover { color: var(--brand); text-decoration: underline; }
.crumb:last-child { color: var(--text); font-weight: 600; }
.crumb-sep { color: var(--text-faint); }

.toolbar { align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.active-filter-badge { display: inline-flex; align-items: center; gap: 4px; }
.clear-filter { border: none; background: none; padding: 0; color: inherit; font-size: 11px; }

.view-toggle { display: flex; gap: 2px; }
.view-toggle .btn.active { background: var(--brand-soft); color: var(--brand-dark); border-color: var(--brand-soft); }

/* Dim the previous folder's listing while the next one loads, instead of
   removing it — keeps the content area's height (and therefore the page's
   scroll extent) stable across navigation. See the loading comment above. */
.grid.is-loading, .table-wrap.is-loading { opacity: 0.5; pointer-events: none; transition: opacity 0.1s ease 0.1s; }

.folder-card { cursor: pointer; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.folder-icon { font-size: 28px; line-height: 1; }

.resource-card { cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
.resource-head { display: flex; align-items: center; gap: 6px; }
.resource-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.match-snippet { background: var(--hover-tint); padding: 6px 8px; border-radius: var(--radius-sm); }
.tags-row { flex-wrap: wrap; }

.badge-warn { background: var(--warning-soft); color: var(--offline-text); }
.badge-danger { background: var(--danger-soft); color: var(--danger); }

.row-clickable { cursor: pointer; }
.filename-sub { font-size: 12px; margin-top: 2px; }
.badge-sm { font-size: 11px; padding: 1px 6px; margin-left: 6px; }
.table-wrap .tags-row { flex-wrap: wrap; gap: 4px; }

/* Mobile list view: vertical cards, no horizontal scroll at all — see the
   template comment above for why this replaces the table on narrow screens. */
.list-mobile { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.list-row { padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
.list-row:last-child { border-bottom: none; }
.list-row:active { background: var(--hover-tint); }
.list-row-main { display: flex; align-items: center; gap: 8px; }
.list-row-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row-meta { flex-wrap: wrap; gap: 6px; margin-top: 4px; align-items: center; }

.fav-btn {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--text-faint);
  font-size: 16px;
  line-height: 1;
  padding: 0;
}
.fav-btn.active { color: var(--warning); }

.tag-pill { border: none; }


.preview-panel { display: flex; justify-content: center; background: var(--hover-tint); border-radius: var(--radius-sm); overflow: hidden; }
.preview-ggb { width: 100%; }
.preview-image { max-width: 100%; max-height: 420px; object-fit: contain; }
.preview-pdf { width: 100%; height: 480px; border: none; }
/* docx-preview (inWrapper: false) renders the page content directly with its
   own generated styles/classes — we only constrain the scroll area, we don't
   restyle its output the way the old mammoth+v-html path had to. */
.preview-docx { width: 100%; max-height: 480px; overflow: auto; padding: 16px 0; background: var(--surface); }
.preview-pptx { width: 100%; display: flex; justify-content: center; }

/* Mobile nav strip: one row of horizontally-scrollable pills replacing the
   desktop sidebar's full-height column — see the template comment above. */
.kc-nav-mobile-wrap { position: relative; margin-bottom: 12px; }

.kc-nav-mobile {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 20px 2px 2px;
  margin: -2px 0 0 -2px;
  /* Let a pill's focus ring or shadow show without being clipped by the
     scroll container, and hide the scrollbar itself (still scrollable via
     touch/trackpad — just no persistent bar taking up the row's height). */
  scrollbar-width: none;
}
.kc-nav-mobile::-webkit-scrollbar { display: none; }

.kc-nav-mobile-fade {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 28px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--bg));
}

.nav-pill {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 500;
  font-size: 13px;
}
.nav-pill.active { background: var(--brand-soft); color: var(--brand-dark); border-color: var(--brand-soft); }

.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 0.45);
  z-index: 90;
}
.folder-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 91;
  max-height: 70vh;
  background: var(--surface);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.folder-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.folder-sheet-head .close { border: none; background: none; font-size: 24px; line-height: 1; color: var(--text-muted); padding: 0 4px; }
.folder-sheet-body { padding: 12px; overflow-y: auto; }

@media (max-width: 768px) {
  .kc-layout { grid-template-columns: 1fr; }
}
</style>
