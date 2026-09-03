<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import { knowledgeNodesApi, resourcesApi } from '@/api/resources';
import type { Envelope, KnowledgeNode, Resource, ResourceType, Tag } from '@/api/types';
import { RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '@/api/types';
import ModalDialog from '@/components/ModalDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import UploadDialog from '@/components/UploadDialog.vue';
import KnowledgeTreeManager from '@/components/KnowledgeTreeManager.vue';

type SectionKey = 'all' | ResourceType | 'favorite' | 'recent' | 'knowledge' | 'tags';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'all', label: '全部资源' },
  { key: 'textbook', label: '教材' },
  { key: 'ppt', label: 'PPT' },
  { key: 'lesson_plan', label: '教案' },
  { key: 'image', label: '图片' },
  { key: 'mistake', label: '错题' },
  { key: 'knowledge', label: '知识点' },
  { key: 'tags', label: '标签' },
  { key: 'favorite', label: '收藏' },
];

const section = ref<SectionKey>('all');
const resources = ref<Resource[]>([]);
const loading = ref(false);
const searchTerm = ref('');
const activeTagId = ref<string | null>(null);
const activeKnowledgeNodeId = ref<string | null>(null);

const tags = ref<Tag[]>([]);
const knowledgeNodes = ref<KnowledgeNode[]>([]);

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

function clearPreview() {
  if (previewImageUrl.value) URL.revokeObjectURL(previewImageUrl.value);
  if (previewPdfUrl.value) URL.revokeObjectURL(previewPdfUrl.value);
  previewImageUrl.value = null;
  previewPdfUrl.value = null;
  previewError.value = null;
  if (docxContainer.value) docxContainer.value.innerHTML = '';
  pptxPreviewer?.destroy?.();
  pptxPreviewer = null;
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

const isResourceTypeSection = computed(
  () => section.value !== 'all' && section.value !== 'favorite' && section.value !== 'recent'
    && section.value !== 'knowledge' && section.value !== 'tags',
);

async function loadResources() {
  loading.value = true;
  try {
    const query: Record<string, string | number | boolean | undefined> = { pageSize: 100 };
    if (searchTerm.value.trim()) query.q = searchTerm.value.trim();
    if (isResourceTypeSection.value) query.type = section.value as ResourceType;
    if (section.value === 'favorite') query.favorite = true;
    if (activeTagId.value) query.tagId = activeTagId.value;
    if (activeKnowledgeNodeId.value) query.knowledgeNodeId = activeKnowledgeNodeId.value;

    const res = await resourcesApi.list(query);
    resources.value = res.data;
  } finally {
    loading.value = false;
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

function selectSection(key: SectionKey) {
  section.value = key;
  activeTagId.value = null;
  activeKnowledgeNodeId.value = null;
  if (key !== 'knowledge' && key !== 'tags') loadResources();
}

function selectTag(tagId: string) {
  section.value = 'all';
  activeTagId.value = tagId;
  activeKnowledgeNodeId.value = null;
  loadResources();
}

function selectKnowledgeNode(nodeId: string) {
  section.value = 'all';
  activeKnowledgeNodeId.value = nodeId;
  activeTagId.value = null;
  loadResources();
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

onMounted(() => {
  loadResources();
  loadTags();
  loadKnowledgeNodes();
});
</script>

<template>
  <div class="page kc-page">
    <header class="page-header">
      <h1>知识中心</h1>
      <div class="row">
        <input v-model="searchTerm" class="input" style="width: 220px" placeholder="搜索标题 / 文件名 / 内容" />
        <button class="btn btn-primary" @click="showUpload = true">+ 上传资源</button>
      </div>
    </header>

    <div class="kc-layout">
      <aside class="kc-nav">
        <button
          v-for="s in SECTIONS"
          :key="s.key"
          class="kc-nav-item"
          :class="{ active: section === s.key && !activeTagId && !activeKnowledgeNodeId }"
          @click="selectSection(s.key)"
        >
          {{ s.label }}
        </button>
      </aside>

      <main class="kc-content">
        <!-- 知识点 tree -->
        <div v-if="section === 'knowledge'" class="stack">
          <KnowledgeTreeManager :nodes="knowledgeNodes" @changed="loadKnowledgeNodes" @select="selectKnowledgeNode" />
        </div>

        <!-- 标签 list -->
        <div v-else-if="section === 'tags'" class="stack">
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

        <!-- Resource grid -->
        <template v-else>
          <div v-if="loading" class="empty">加载中…</div>
          <EmptyState v-else-if="!resources.length" icon="search" title="没有找到资源">
            试试上传第一个教学资源，或调整筛选条件
          </EmptyState>
          <div v-else class="grid">
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
        </template>
      </main>
    </div>

    <!-- Upload modal -->
    <UploadDialog
      v-if="showUpload"
      :collections="[]"
      :tags="tags"
      :knowledge-nodes="knowledgeNodes"
      @close="showUpload = false"
      @uploaded="() => { showUpload = false; loadResources(); }"
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

        <!-- Visual preview: image / PDF / Word / PPT. Renders nothing for
             types with no preview — e.g. plain text or a legacy .doc/.ppt
             this project can't parse (chunk text is still searchable, just
             not shown here — see docs/API.md's download endpoint note).
             Word/PPT containers stay in the DOM (v-show, not v-if/v-else)
             because loadPreview() needs the ref to already exist when its
             dynamically-imported renderer mounts into it after nextTick. -->
        <div v-if="previewLoading" class="empty-inline">预览加载中…</div>
        <p v-else-if="previewError" class="error-text">{{ previewError }}</p>
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
.kc-layout { display: grid; grid-template-columns: 180px 1fr; gap: 20px; align-items: start; }

.kc-nav { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 12px; }
.kc-nav-item {
  text-align: left;
  padding: 9px 12px;
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-weight: 500;
}
.kc-nav-item:hover { background: var(--hover-tint); color: var(--text); }
.kc-nav-item.active { background: var(--brand-soft); color: var(--brand-dark); }

.resource-card { cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
.resource-head { display: flex; align-items: center; gap: 6px; }
.resource-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.match-snippet { background: var(--hover-tint); padding: 6px 8px; border-radius: var(--radius-sm); }
.tags-row { flex-wrap: wrap; }

.badge-warn { background: var(--warning-soft); color: var(--offline-text); }
.badge-danger { background: var(--danger-soft); color: var(--danger); }

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
.preview-image { max-width: 100%; max-height: 420px; object-fit: contain; }
.preview-pdf { width: 100%; height: 480px; border: none; }
/* docx-preview (inWrapper: false) renders the page content directly with its
   own generated styles/classes — we only constrain the scroll area, we don't
   restyle its output the way the old mammoth+v-html path had to. */
.preview-docx { width: 100%; max-height: 480px; overflow: auto; padding: 16px 0; background: var(--surface); }
.preview-pptx { width: 100%; display: flex; justify-content: center; }

@media (max-width: 768px) {
  .kc-layout { grid-template-columns: 1fr; }
  .kc-nav { flex-direction: row; flex-wrap: wrap; position: static; }
}
</style>
