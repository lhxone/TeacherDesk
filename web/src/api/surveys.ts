import { api, ApiError } from '@/api/client';

export type SurveyFieldType = 'text' | 'textarea' | 'phone' | 'idcard' | 'number' | 'date' | 'select' | 'file';
export type SurveyStatus = 'draft' | 'published' | 'closed';
export interface SurveyField {
  id: string;
  type: SurveyFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
}
export interface Survey {
  id: string;
  title: string;
  description: string;
  status: SurveyStatus;
  publicToken: string;
  version: number;
  fields: SurveyField[];
  createdAt: string;
  updatedAt: string;
  responseCount: number;
}
export interface SurveyResponse {
  id: string;
  createdAt: string;
  fields: SurveyField[];
  answers: Record<string, string>;
  files: { id: string; fieldId: string; originalFilename: string; fileSize: number }[];
}
export type PublicSurvey = Pick<Survey, 'title' | 'description' | 'version' | 'fields'>;
export type SurveyContent = Pick<Survey, 'title' | 'description' | 'fields'>;
export const surveyFieldTypes: { type: SurveyFieldType; label: string }[] = [
  { type: 'text', label: '单行文本' }, { type: 'textarea', label: '多行文本' },
  { type: 'phone', label: '电话号码' }, { type: 'idcard', label: '身份证号' },
  { type: 'number', label: '数字' }, { type: 'date', label: '日期' },
  { type: 'select', label: '下拉单选' }, { type: 'file', label: '文件上传' },
];
export const surveyStatusLabels: Record<SurveyStatus, string> = {
  draft: '草稿', published: '收集中', closed: '已关闭',
};
type ResponsePage = { data: SurveyResponse[]; meta: { total: number; page: number; pageSize: number } };

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to consume the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function surveyPublicUrl(token: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(token)}`;
}

export const surveysApi = {
  list: () => api.get<{ data: Survey[] }>('/surveys'),
  get: (id: string) => api.get<{ data: Survey }>(`/surveys/${encodeURIComponent(id)}`),
  create: (body: SurveyContent) => api.post<{ data: Survey }>('/surveys', body),
  update: (id: string, body: Partial<SurveyContent> & { version: number; status?: SurveyStatus }) =>
    api.patch<{ data: Survey }>(`/surveys/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.del(`/surveys/${encodeURIComponent(id)}`),
  responses: (id: string, page = 1, pageSize = 20) =>
    api.get<ResponsePage>(`/surveys/${encodeURIComponent(id)}/responses`, { page, pageSize }),
  async allResponses(id: string): Promise<SurveyResponse[]> {
    const first = await surveysApi.responses(id, 1, 100);
    const rows = [...first.data];
    const pages = Math.ceil(first.meta.total / first.meta.pageSize);
    for (let page = 2; page <= pages; page++) {
      rows.push(...(await surveysApi.responses(id, page, first.meta.pageSize)).data);
    }
    return rows;
  },
  async download(id: string, file: SurveyResponse['files'][number]): Promise<void> {
    const blob = await api.blob(`/surveys/${encodeURIComponent(id)}/files/${encodeURIComponent(file.id)}`);
    saveBlob(blob, file.originalFilename);
  },
};

/** Public links are independent of the teacher session, including on shared devices. */
async function publicRequest<T>(token: string, body?: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/public/surveys/${encodeURIComponent(token)}${body ? '/responses' : ''}`, {
      method: body ? 'POST' : 'GET', body, credentials: 'omit', cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }
  let result: { error?: { code?: string; message?: string; details?: { field?: string; message: string }[] } } = {};
  try { result = await response.json(); } catch { /* A proxy can return a non-JSON error. */ }
  if (!response.ok) {
    const fallback = response.status === 413 ? '文件过大，请压缩后重试' : '请求失败，请稍后重试';
    throw new ApiError(response.status, result.error?.code ?? 'REQUEST_FAILED', result.error?.message ?? fallback, result.error?.details);
  }
  return result as T;
}

export const publicSurveysApi = {
  get: (token: string) => publicRequest<{ data: PublicSurvey }>(token),
  submit(token: string, version: number, answers: Record<string, string>, files: Record<string, File>) {
    const body = new FormData();
    body.append('version', String(version));
    body.append('answers', JSON.stringify(answers));
    for (const [fieldId, file] of Object.entries(files)) body.append(`file:${fieldId}`, file);
    return publicRequest<{ data: { id: string } }>(token, body);
  },
};

/** Keep each historical question label/type so later edits cannot relabel old answers. */
export function responsesCsv(responses: SurveyResponse[]): string {
  const columns = new Map<string, SurveyField>();
  const keyOf = (field: SurveyField) => JSON.stringify([field.id, field.type, field.label]);
  for (const response of responses) for (const field of response.fields) columns.set(keyOf(field), field);
  const entries = [...columns.entries()];
  const labels = new Map<string, number>();
  const escape = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const headers = ['提交编号', '提交时间', ...entries.map(([, field]) => {
    const count = (labels.get(field.label) ?? 0) + 1;
    labels.set(field.label, count);
    return count > 1 ? `${field.label}（${count}）` : field.label;
  })];
  const rows = responses.map(response => {
    const fields = new Set(response.fields.map(keyOf));
    return [response.id, new Date(response.createdAt).toLocaleString('zh-CN', { hour12: false }), ...entries.map(([key, field]) => {
      if (!fields.has(key)) return '';
      return field.type === 'file'
        ? response.files.filter(file => file.fieldId === field.id).map(file => file.originalFilename).join('；')
        : response.answers[field.id] ?? '';
    })];
  });
  return '\uFEFF' + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
}
