import { api } from '@/api/client';
import type {
  Envelope,
  KnowledgeNode,
  Paged,
  Resource,
  ResourceCollection,
  ResourceStatus,
  ResourceType,
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
   * Multipart upload. Uses fetch directly (not api.upload, which is fixed to
   * a single "file" field with no extra text fields) so title/type/subject/
   * grade/collectionId/tagIds/knowledgeNodeIds can ride along in one request.
   */
  async upload(
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

    const { tokenStore } = await import('@/api/client');
    const headers: Record<string, string> = {};
    if (tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`;

    const res = await fetch('/api/v1/resources', { method: 'POST', headers, body: form });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const { ApiError } = await import('@/api/client');
      const err = body.error ?? {};
      throw new ApiError(res.status, err.code ?? 'INTERNAL_ERROR', err.message ?? '上传失败', err.details);
    }
    return body as Envelope<Resource>;
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
