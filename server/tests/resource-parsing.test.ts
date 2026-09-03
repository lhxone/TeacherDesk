import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { extractText, inferResourceType, isParseable } from '../src/lib/resourceParsing.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Build a minimal valid .pptx with N slides, each containing one text run. */
function buildPptx(slideTexts: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  );
  slideTexts.forEach((text, i) => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>${text}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(xml));
  });
  return zip.toBuffer();
}

describe('inferResourceType', () => {
  it('classifies images', () => {
    expect(inferResourceType('image/png', 'a.png')).toBe('image');
  });
  it('classifies pptx as ppt', () => {
    expect(inferResourceType(PPTX_MIME, 'a.pptx')).toBe('ppt');
  });
  it('classifies docx and pdf as document', () => {
    expect(inferResourceType(DOCX_MIME, 'a.docx')).toBe('document');
    expect(inferResourceType('application/pdf', 'a.pdf')).toBe('document');
  });
});

describe('isParseable', () => {
  it('is true for pdf/pptx/docx, false for images and plain text', () => {
    expect(isParseable('application/pdf', 'a.pdf')).toBe(true);
    expect(isParseable(PPTX_MIME, 'a.pptx')).toBe(true);
    expect(isParseable(DOCX_MIME, 'a.docx')).toBe(true);
    expect(isParseable('image/png', 'a.png')).toBe(false);
    expect(isParseable('text/plain', 'a.txt')).toBe(false);
  });
});

describe('extractText: pptx', () => {
  it('produces one chunk per slide with the slide number as pageNumber', async () => {
    const buffer = buildPptx(['第一页：勾股定理', '第二页：例题讲解', '第三页：课堂练习']);
    const result = await extractText(buffer, PPTX_MIME, 'lesson.pptx');

    expect(result.pageCount).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0]).toMatchObject({ pageNumber: 1, ordinal: 0 });
    expect(result.chunks[0].content).toContain('勾股定理');
    expect(result.chunks[2].pageNumber).toBe(3);
  });

  it('skips slides with no text content', async () => {
    const buffer = buildPptx(['有内容', '']);
    const result = await extractText(buffer, PPTX_MIME, 'lesson.pptx');
    expect(result.chunks).toHaveLength(1);
  });
});

describe('extractText: unsupported formats', () => {
  it('returns no chunks for a legacy .doc without throwing', async () => {
    const result = await extractText(Buffer.from('binary junk'), 'application/msword', 'old.doc');
    expect(result.chunks).toEqual([]);
  });
});
