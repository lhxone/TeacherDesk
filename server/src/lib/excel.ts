/**
 * Shared Excel (.xlsx) helpers for import/export flows: building a styled
 * single-sheet template and reading back an uploaded workbook's first sheet
 * as plain string rows. Keeps the visual style (header row, banding) in one
 * place instead of duplicated across export/import routes.
 */
import ExcelJS from 'exceljs';
import type { MultipartFile } from '@fastify/multipart';
import { ApiError } from '../errors.js';

export type ColumnSpec = { header: string; key: string; width?: number };

/** Build a single-sheet workbook with a title row, styled header, and banded data rows. */
export async function buildTemplateWorkbook(
  sheetName: string,
  title: string,
  columns: ColumnSpec[],
  rows: Record<string, unknown>[],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TeacherDesk';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 2 }] });
  sheet.columns = columns;

  sheet.spliceRows(1, 0, []);
  sheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { size: 14, bold: true, color: { argb: 'FF1F2937' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  const headerRow = sheet.getRow(2);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    };
  });

  rows.forEach((r, i) => {
    const row = sheet.addRow(r);
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
      if (i % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
    });
  });

  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };

  return workbook.xlsx.writeBuffer();
}

/** RFC 5987 filename* so non-ASCII names survive the Content-Disposition header. */
export function xlsxAttachment(name: string): string {
  return `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Read an uploaded multipart .xlsx file's first worksheet into rows of
 * trimmed cell strings, skipping the title/header rows produced by
 * buildTemplateWorkbook (row 1 = title, row 2 = header).
 */
export async function readTemplateRows(file: MultipartFile): Promise<string[][]> {
  const buffer = await file.toBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's Buffer type predates @types/node's generic Buffer<T>; the
    // runtime value is a plain Buffer either way (same skew exceljs.load
    // hits elsewhere in this codebase, e.g. analytics.test.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw ApiError.validation('无法解析 Excel 文件，请使用下载的模板填写');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.validation('Excel 文件中没有工作表');

  const rows: string[][] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return; // title + header rows
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (v === null || v === undefined) cells.push('');
      else if (typeof v === 'object' && 'text' in (v as object)) cells.push(String((v as { text: unknown }).text ?? ''));
      else if (typeof v === 'object' && 'result' in (v as object)) cells.push(String((v as { result: unknown }).result ?? ''));
      else cells.push(String(v).trim());
    });
    if (cells.some((c) => c.trim() !== '')) rows.push(cells.map((c) => c.trim()));
  });

  return rows;
}

/** Pull the single uploaded file off a multipart request, or 400 if missing. */
export async function requireUploadedFile(req: {
  file: () => Promise<MultipartFile | undefined>;
}): Promise<MultipartFile> {
  const file = await req.file();
  if (!file) throw ApiError.validation('请上传 Excel 文件');
  if (!/\.xlsx$/i.test(file.filename ?? '')) {
    throw ApiError.validation('请上传 .xlsx 格式的 Excel 文件');
  }
  return file;
}
