import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setAuthFailureHandler, tokenStore } from '../client';
import { publicSurveysApi, responsesCsv, surveyPublicUrl, type SurveyResponse } from '../surveys';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { location: { origin: 'https://teacherdesk.example' } });
});

afterEach(() => {
  setAuthFailureHandler(() => {});
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

describe('public survey API', () => {
  it('fetches anonymously without reading teacher tokens or caching sensitive answers', async () => {
    tokenStore.set('teacher-access', 'teacher-refresh');
    const readStorage = vi.spyOn(localStorage, 'getItem');
    const body = { data: { title: '新生调查', description: '', version: 3, fields: [] } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(publicSurveysApi.get('share-token')).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/public/surveys/share-token');
    expect(options).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });
    expect(new Headers(options.headers).has('authorization')).toBe(false);
    expect(readStorage).not.toHaveBeenCalled();
  });

  it('encodes a share token as one URL segment in both the public link and API request', async () => {
    const token = 'token/with?reserved#characters';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    expect(surveyPublicUrl(token)).toBe('https://teacherdesk.example/s/token%2Fwith%3Freserved%23characters');
    await publicSurveysApi.get(token);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/public/surveys/token%2Fwith%3Freserved%23characters');
  });

  it('submits version, answers and each file under its field ID in one anonymous multipart request', async () => {
    tokenStore.set('old-access', 'old-refresh');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 'response-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const answers = { name: '张三', phone: '13800138000' };
    const proof = new File(['proof contents'], '证明.txt', { type: 'text/plain' });
    const photo = new File(['photo contents'], 'photo.png', { type: 'image/png' });

    await expect(publicSurveysApi.submit('shared', 7, answers, { proof, photo })).resolves.toEqual({ data: { id: 'response-1' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/public/surveys/shared/responses');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' });
    const headers = new Headers(options.headers);
    expect(headers.has('authorization')).toBe(false);
    // The browser must choose the multipart boundary itself.
    expect(headers.has('content-type')).toBe(false);
    expect(options.body).toBeInstanceOf(FormData);
    const form = options.body as FormData;
    expect([...form.keys()]).toEqual(['version', 'answers', 'file:proof', 'file:photo']);
    expect(form.get('version')).toBe('7');
    expect(JSON.parse(form.get('answers') as string)).toEqual(answers);
    expect((form.get('file:proof') as File).name).toBe('证明.txt');
    expect(await (form.get('file:proof') as File).text()).toBe('proof contents');
    expect((form.get('file:photo') as File).name).toBe('photo.png');
  });

  it('uses the same multipart contract when the form has no attachments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 'response-2' } }));
    vi.stubGlobal('fetch', fetchMock);

    await publicSurveysApi.submit('shared', 1, { name: '李四' }, {});

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(['version', 'answers']);
    expect(body.get('answers')).toBe(JSON.stringify({ name: '李四' }));
  });

  it('does not refresh credentials, clear teacher tokens or redirect on a public 401', async () => {
    tokenStore.set('expired-access', 'valid-refresh');
    const authFailure = vi.fn();
    setAuthFailureHandler(authFailure);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {
      error: { code: 'UNAUTHENTICATED', message: '无法访问此调查' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(publicSurveysApi.get('shared')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenStore.access).toBe('expired-access');
    expect(tokenStore.refresh).toBe('valid-refresh');
    expect(authFailure).not.toHaveBeenCalled();
  });

  it('preserves structured validation details so the respondent can correct the right field', async () => {
    const details = [{ field: 'answers.phone', message: '请输入有效电话号码' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, {
      error: { code: 'VALIDATION_ERROR', message: '请检查填写内容', details },
    })));

    await expect(publicSurveysApi.submit('shared', 1, { phone: 'bad' }, {})).rejects.toMatchObject({
      status: 400, code: 'VALIDATION_ERROR', message: '请检查填写内容', details,
    });
  });

  it('surfaces a changed form as a conflict without automatically resubmitting answers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, {
      error: { code: 'CONFLICT', message: '调查内容已更新，请刷新后填写' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(publicSurveysApi.submit('shared', 1, { name: '张三' }, {})).rejects.toMatchObject({
      status: 409, code: 'CONFLICT', message: '调查内容已更新，请刷新后填写',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns a proxy HTML upload-size error into a useful typed error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Request too large</html>', { status: 413 })));

    const error = await publicSurveysApi.submit('shared', 1, {}, {}).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, message: '文件过大，请压缩后重试' });
  });

  it.each(['get', 'submit'] as const)('reports network failure for %s without retrying a public request', async (operation) => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const request = operation === 'get'
      ? publicSurveysApi.get('shared')
      : publicSurveysApi.submit('shared', 1, { name: '张三' }, {});

    await expect(request).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('survey response CSV', () => {
  const response = (overrides: Partial<SurveyResponse>): SurveyResponse => ({
    id: 'response-1', createdAt: '2026-09-21T08:00:00.000Z', fields: [], answers: {}, files: [], ...overrides,
  });

  it('keeps historical question labels distinct when a field is renamed after collection', () => {
    const oldField = { id: 'contact', type: 'text' as const, label: '学生姓名', required: true };
    const newField = { ...oldField, label: '监护人姓名' };
    const csv = responsesCsv([
      response({ fields: [oldField], answers: { contact: '张三' } }),
      response({ id: 'response-2', fields: [newField], answers: { contact: '张家长' } }),
    ]);
    const [header, oldRow, newRow] = csv.split('\r\n');

    expect(header).toContain('"学生姓名","监护人姓名"');
    expect(oldRow).toMatch(/,"张三",""$/);
    expect(newRow).toMatch(/,"","张家长"$/);
  });

  it('escapes quoted text, neutralizes spreadsheet formulas and exports filenames for file fields', () => {
    const csv = responsesCsv([response({
      fields: [
        { id: 'name', type: 'text', label: '=标题公式', required: false },
        { id: 'notes', type: 'textarea', label: '备注', required: false },
        { id: 'proof', type: 'file', label: '材料', required: false },
      ],
      answers: { name: '=HYPERLINK("https://example.com")', notes: '需要,"确认"' },
      files: [{ id: 'file-1', fieldId: 'proof', originalFilename: '+危险文件.txt', fileSize: 3 }],
    })]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=标题公式"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"需要,""确认"""');
    expect(csv).toContain('"\'+危险文件.txt"');
  });
});
