import { api, request } from '@/api/client';
import type {
  Envelope,
  KnowledgeNode,
  Paged,
  Resource,
  ResourceCollection,
  ResourceStatus,
  ResourceType,
  Tag,
} from '@/api/types';

export type ResourceListQuery = {
  type?: ResourceType;
  subject?: string;
  grade?: string;
  collectionId?: string;
  tagId?: string;
  knowledgeNodeId?: string;
  status?: ResourceStatus;
  favorite?: boolean;
  recent?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
};

export const resourcesApi = {
  list: (query: ResourceListQuery = {}) => api.get<Paged<Resource>>('/resources', query),
  get: (id: string) => api.get<Envelope<Resource>>(`/resources/${id}`),
  update: (id: string, payload: Partial<{
    title: string;
    subject: string | null;
    grade: string | null;
    note: string | null;
    collectionId: string | null;
    isFavorite: boolean;
    tagIds: string[];
    knowledgeNodeIds: string[];
    type: ResourceType;
  }>) => api.patch<Envelope<Resource>>(`/resources/${id}`, payload),
  remove: (id: string) => api.del(`/resources/${id}`),
  touch: (id: string) => api.post(`/resources/${id}/touch`),
  retry: (id: string) => api.post(`/resources/${id}/retry`),
  // Not currently used for downloading (see `download()` below for why a
  // plain navigation to this URL doesn't work) — kept for a future preview
  // feature (e.g. embedding), which will need its own answer for auth on a
  // plain <iframe src> the same way.
  downloadUrl: (id: string) => `/api/v1/resources/${id}/download`,

  /**
   * Fetch the file as a Blob and save it via a temporary <a download> link.
   * A plain `window.open(downloadUrl)` does NOT work here: that's a normal
   * browser navigation, which never attaches the Authorization header the
   * API requires (only fetch/XHR calls do that), so the new tab just shows
   * a 401 JSON error instead of downloading anything.
   */
  async download(id: string, filename: string): Promise<void> {
    const blob = await api.blob(`/resources/${id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Multipart upload. Uses `request()` directly (not api.upload, which is
   * fixed to a single "file" field with no extra text fields) so
   * title/type/subject/grade/collectionId/tagIds/knowledgeNodeIds can ride
   * along in one request — and, going through `request()`, an expired access
   * token gets the same refresh-and-retry treatment as any other endpoint.
   */
  upload(
    file: File,
    fields: Partial<{
      title: string;
      type: ResourceType;
      subject: string;
      grade: string;
      note: string;
      collectionId: string;
      tagIds: string[];
      knowledgeNodeIds: string[];
    }> = {},
  ): Promise<Envelope<Resource>> {
    const form = new FormData();
    if (fields.title) form.append('title', fields.title);
    if (fields.type) form.append('type', fields.type);
    if (fields.subject) form.append('subject', fields.subject);
    if (fields.grade) form.append('grade', fields.grade);
    if (fields.note) form.append('note', fields.note);
    if (fields.collectionId) form.append('collectionId', fields.collectionId);
    if (fields.tagIds?.length) form.append('tagIds', fields.tagIds.join(','));
    if (fields.knowledgeNodeIds?.length) form.append('knowledgeNodeIds', fields.knowledgeNodeIds.join(','));
    form.append('file', file);

    return request<Envelope<Resource>>('/resources', { method: 'POST', body: form });
  },

  /** Replace a resource's file content in place (e.g. "save" after live-editing a GeoGebra file). */
  saveContent(id: string, blob: Blob, filename: string): Promise<Envelope<Resource>> {
    const form = new FormData();
    form.append('file', blob, filename);
    return request<Envelope<Resource>>(`/resources/${id}/content`, { method: 'PUT', body: form });
  },

  /**
   * Fetch the file as a Blob without triggering a save-as download — used by
   * the GeoGebra applet, which needs the raw bytes to open, not a browser
   * download prompt (see download() above for why a plain URL won't do).
   */
  fetchBlob(id: string): Promise<Blob> {
    return api.blob(`/resources/${id}/download`);
  },
};

export const knowledgeNodesApi = {
  list: (query: { subject?: string; grade?: string } = {}) =>
    api.get<{ data: KnowledgeNode[] }>('/knowledge-nodes', query),
  create: (payload: { name: string; parentId?: string | null; subject?: string | null; grade?: string | null }) =>
    api.post<Envelope<KnowledgeNode>>('/knowledge-nodes', payload),
  update: (id: string, payload: Partial<{ name: string; parentId: string | null; subject: string | null; grade: string | null }>) =>
    api.patch<Envelope<KnowledgeNode>>(`/knowledge-nodes/${id}`, payload),
  remove: (id: string) => api.del(`/knowledge-nodes/${id}`),
};

export const resourceCollectionsApi = {
  list: () => api.get<{ data: ResourceCollection[] }>('/resource-collections'),
  create: (payload: { name: string; parentId?: string | null }) =>
    api.post<Envelope<ResourceCollection>>('/resource-collections', payload),
  update: (id: string, payload: Partial<{ name: string; parentId: string | null }>) =>
    api.patch<Envelope<ResourceCollection>>(`/resource-collections/${id}`, payload),
  remove: (id: string) => api.del(`/resource-collections/${id}`),
};

// Resource tags (知识中心) — a namespace separate from student tags (see the
// Tag model's `scope` column comment in schema.prisma) despite sharing one
// table; every call here is pinned to scope=resource so it can never read,
// create, or collide with a student tag of the same name. This is the one
// place with a create/rename/recolor/delete UI (TagManager.vue) — everywhere
// else just picks from the list.
export const tagsApi = {
  list: () => api.get<Envelope<Tag[]>>('/tags', { scope: 'resource' }),
  create: (payload: { name: string; color?: string }) =>
    api.post<Envelope<Tag>>('/tags', { ...payload, scope: 'resource' }),
  update: (id: string, payload: Partial<{ name: string; color: string }>) =>
    api.patch<Envelope<Tag>>(`/tags/${id}`, payload),
  remove: (id: string) => api.del(`/tags/${id}`),
};
