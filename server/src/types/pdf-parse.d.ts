/**
 * Minimal ambient typing for pdf-parse@1.x, which ships no bundled types and
 * whose published @types package targets a different major line. Only the
 * shape actually used by lib/resourceParsing.ts is declared.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagerender?: (pageData: any) => Promise<string> | string;
    max?: number;
  }

  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
