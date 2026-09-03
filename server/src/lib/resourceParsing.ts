/**
 * Text extraction for uploaded teaching resources. Runs in-process (no
 * LibreOffice/microservice) — pure-JS libraries only, so the API image stays
 * a single small container:
 *   - PDF: pdf-parse (pdf.js under the hood), one chunk per page.
 *   - PPTX: OOXML is a zip of per-slide XML parts; we unzip with adm-zip and
 *     pull text runs out of each slideN.xml with fast-xml-parser. One chunk
 *     per slide (goal requirement: search must locate a PPT page number).
 *   - DOCX: mammoth converts to HTML preserving heading tags, which we split
 *     on to produce section chunks (goal requirement: locate a Word chapter).
 *   - Images / anything else: no text extraction (goal defers OCR); the
 *     resource goes straight to 'ready' with zero chunks.
 *
 * A parser never throws for "this file has no extractable text" (empty PPT,
 * scanned PDF, etc.) — it only throws for "this file could not be opened at
 * all", which the caller maps to the resource's `failed` status.
 */
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import mammoth from 'mammoth';
// Import pdf-parse's inner implementation directly rather than its package
// entry (`pdf-parse`): that entry file runs a `require.main`-guarded demo
// block that reads a bundled sample PDF off disk, guarded by `!module.parent`
// — a check that is always true under Vitest/ESM's loader (there is no CJS
// `module.parent` there), so importing the package root throws ENOENT for a
// file this project never bundled. `lib/pdf-parse.js` is the actual parser
// with no such guard. No bundled types either way; declared in
// src/types/pdf-parse.d.ts.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export type ExtractedChunk = {
  ordinal: number;
  pageNumber?: number;
  sectionLabel?: string;
  content: string;
};

export type ExtractionResult = {
  chunks: ExtractedChunk[];
  pageCount?: number;
};

/** Resource.type inferred from mimeType/extension, used both for storage bucketing and to pick a parser. */
export function inferResourceType(mimeType: string, filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (mimeType.startsWith('image/')) return 'image';
  if (ext === 'pptx' || ext === 'ppt' || mimeType.includes('presentation')) return 'ppt';
  if (ext === 'docx' || ext === 'doc' || mimeType.includes('wordprocessingml') || mimeType === 'application/msword') return 'document';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'document';
  return 'document';
}

/** Whether this resource type/mime combination has a text extractor at all. */
export function isParseable(mimeType: string, filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ext === 'pdf' || ext === 'pptx' || ext === 'docx' || mimeType === 'application/pdf'
    || mimeType.includes('presentationml') || mimeType.includes('wordprocessingml');
}

export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractionResult> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (ext === 'pdf' || mimeType === 'application/pdf') return extractPdf(buffer);
  if (ext === 'pptx' || mimeType.includes('presentationml')) return extractPptx(buffer);
  if (ext === 'docx' || mimeType.includes('wordprocessingml')) return extractDocx(buffer);

  // .ppt / .doc (legacy binary OOXML) are not supported by any pure-JS parser
  // here; the resource still uploads and stores fine, just with no chunks.
  return { chunks: [] };
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse exposes a `pagerender` hook that runs once per page; using it
  // (rather than parsing result.text as one blob) is what lets each page
  // become its own ResourceChunk with an accurate page number.
  const pages: string[] = [];
  await pdfParse(buffer, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item: { str?: string }) => item.str ?? '').join(' ');
      pages.push(text);
      return text;
    },
  });

  const chunks: ExtractedChunk[] = pages
    .map((content, i) => ({ ordinal: i, pageNumber: i + 1, content: content.trim() }))
    .filter((c) => c.content.length > 0);

  return { chunks, pageCount: pages.length };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = new AdmZip(buffer);
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' });

  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = Number(a.entryName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.entryName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });

  const chunks: ExtractedChunk[] = [];
  slideEntries.forEach((entry, i) => {
    const xml = entry.getData().toString('utf-8');
    const text = extractPptxSlideText(xml, parser);
    if (text.trim()) {
      chunks.push({ ordinal: i, pageNumber: i + 1, content: text.trim() });
    }
  });

  return { chunks, pageCount: slideEntries.length };
}

/** Pull every <a:t> text run out of a slideN.xml part, in document order. */
function extractPptxSlideText(xml: string, parser: XMLParser): string {
  const texts: string[] = [];
  // fast-xml-parser strips namespace prefixes by default? No — it keeps them,
  // so nodes are keyed "a:t". We walk generically rather than hard-coding the
  // full slide schema, since slide XML nesting varies (tables, groups, etc.).
  const doc = parser.parse(xml);
  collectTagText(doc, 'a:t', texts);
  return texts.join(' ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectTagText(node: any, tag: string, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectTagText(item, tag, out);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === tag) {
      if (typeof value === 'string') out.push(value);
      else if (typeof value === 'object' && value !== null && '#text' in (value as object)) {
        out.push(String((value as { '#text': unknown })['#text'] ?? ''));
      }
    } else {
      collectTagText(value, tag, out);
    }
  }
}

/**
 * Convert a .docx buffer to HTML for the preview dialog. Deliberately not
 * persisted anywhere (no new column/table) — the preview endpoint calls this
 * on demand and mammoth is fast enough (well under a second for a typical
 * lesson plan) that re-running it per preview open is cheaper than adding
 * storage for it. Separate from extractDocx() below, which produces the
 * plain-text search chunks and must keep working even if this changes.
 */
export async function convertDocxToHtml(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return html;
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer });

  // Split on heading tags so each section becomes its own chunk with a
  // section label ("第一章 有理数"). A document with no headings at all
  // becomes one chunk with no sectionLabel.
  const sections: { label?: string; html: string }[] = [];
  const headingRe = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
  let lastIndex = 0;
  let lastLabel: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(html))) {
    if (match.index > lastIndex) {
      sections.push({ label: lastLabel, html: html.slice(lastIndex, match.index) });
    }
    lastLabel = stripTags(match[1]);
    lastIndex = headingRe.lastIndex;
  }
  sections.push({ label: lastLabel, html: html.slice(lastIndex) });

  const chunks: ExtractedChunk[] = sections
    .map((s, i) => ({ ordinal: i, sectionLabel: s.label, content: stripTags(s.html).trim() }))
    .filter((c) => c.content.length > 0);

  return { chunks };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
