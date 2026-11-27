/**
 * Dependency-free PDF statement renderer.
 *
 * Emits a PDF 1.4 document using the standard Helvetica fonts (no embedding),
 * laid out as an A4-landscape table with a branded header, a summary block,
 * repeating column headers and "Page x of y" footers. The output is pure
 * ASCII (non-ASCII text is written as WinAnsi octal escapes), so it can be
 * handed straight to `new Blob([pdf], { type: 'application/pdf' })` and byte
 * offsets in the xref table equal string offsets.
 */

export interface PdfColumn {
  header: string;
  /** Share of the table width; normalised across all columns. */
  weight: number;
  align?: 'left' | 'right';
}

export interface PdfStatementInput {
  title: string;
  subtitle?: string;
  /** Label / value pairs shown under the header. */
  summary?: [string, string][];
  columns: PdfColumn[];
  rows: string[][];
  /** Shown instead of rows when `rows` is empty. */
  emptyMessage?: string;
}

const PAGE_WIDTH = 842; // A4 landscape, points
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const HEADER_HEIGHT = 64;
const ROW_HEIGHT = 18;
const TABLE_FONT_SIZE = 8;
const FOOTER_Y = 22;

// AnchorPoint brand blue / slate, as PDF RGB fractions.
const BRAND = '0.231 0.510 0.965';
const INK = '0.122 0.161 0.216';
const MUTED = '0.392 0.455 0.545';
const ZEBRA = '0.953 0.961 0.976';
const RULE = '0.886 0.910 0.941';

/** Approximate Helvetica advance width (em fraction) for layout truncation. */
const charWidth = (ch: string): number => {
  if (/[ilI.,:;'|!]/.test(ch)) return 0.28;
  if (/[mwMW@]/.test(ch)) return 0.83;
  if (/[0-9$]/.test(ch)) return 0.556; // Helvetica figures are tabular
  if (/[A-Z#%&]/.test(ch)) return 0.67;
  return 0.52;
};

export const textWidth = (text: string, fontSize: number): number =>
  [...text].reduce((sum, ch) => sum + charWidth(ch), 0) * fontSize;

/** Shortens `text` with an ellipsis (middle-truncation for long hashes) to fit `maxWidth`. */
export const fitText = (text: string, maxWidth: number, fontSize: number): string => {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const isToken = !/\s/.test(text) && text.length > 16;
  const chars = [...text];
  if (isToken) {
    let keep = Math.floor(chars.length / 2);
    while (keep > 2) {
      const candidate = `${chars.slice(0, keep).join('')}...${chars.slice(-keep).join('')}`;
      if (textWidth(candidate, fontSize) <= maxWidth) return candidate;
      keep -= 1;
    }
  }
  let end = chars.length;
  while (end > 1) {
    const candidate = `${chars.slice(0, end).join('')}...`;
    if (textWidth(candidate, fontSize) <= maxWidth) return candidate;
    end -= 1;
  }
  return '...';
};

/** WinAnsi code points for the common non-Latin-1 characters we may print. */
const WIN_ANSI_EXTRAS: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Escapes text for a PDF literal string, keeping the output pure ASCII. */
export const pdfString = (text: string): string => {
  let out = '';
  for (const ch of text) {
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) {
      out += ch;
      continue;
    }
    const byte = WIN_ANSI_EXTRAS[ch] ?? (code >= 0xa0 && code <= 0xff ? code : 0x3f /* ? */);
    out += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `(${out})`;
};

const text = (x: number, y: number, value: string, font: 'F1' | 'F2', size: number, color = INK) =>
  `BT ${color} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(value)} Tj ET`;

const rect = (x: number, y: number, w: number, h: number, color: string) =>
  `${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`;

const line = (x1: number, y: number, x2: number, color: string) =>
  `${color} RG 0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`;

/** Builds the PDF document as an ASCII string. */
export function renderPdfStatement(input: PdfStatementInput): string {
  const tableWidth = PAGE_WIDTH - MARGIN * 2;
  const totalWeight = input.columns.reduce((s, c) => s + c.weight, 0) || 1;
  const widths = input.columns.map((c) => (c.weight / totalWeight) * tableWidth);
  const xs = widths.reduce<number[]>((acc, _w, i) => [...acc, i === 0 ? MARGIN : acc[i - 1] + widths[i - 1]], []);
  const cellPad = 4;

  const drawCell = (value: string, col: number, y: number, font: 'F1' | 'F2', color = INK) => {
    const maxW = widths[col] - cellPad * 2;
    const fitted = fitText(value, maxW, TABLE_FONT_SIZE);
    const x =
      input.columns[col].align === 'right'
        ? xs[col] + widths[col] - cellPad - textWidth(fitted, TABLE_FONT_SIZE)
        : xs[col] + cellPad;
    return text(x, y, fitted, font, TABLE_FONT_SIZE, color);
  };

  const drawTableHeader = (top: number) => {
    const ops = [rect(MARGIN, top - ROW_HEIGHT, tableWidth, ROW_HEIGHT, INK)];
    input.columns.forEach((c, i) => ops.push(drawCell(c.header, i, top - 12, 'F2', '1 1 1')));
    return ops;
  };

  const pages: string[][] = [];
  let ops: string[] = [];

  // First page: branded header and summary.
  ops.push(rect(0, PAGE_HEIGHT - HEADER_HEIGHT, PAGE_WIDTH, HEADER_HEIGHT, BRAND));
  ops.push(text(MARGIN, PAGE_HEIGHT - 30, 'AnchorPoint', 'F2', 18, '1 1 1'));
  ops.push(text(MARGIN, PAGE_HEIGHT - 48, input.title, 'F1', 11, '1 1 1'));
  if (input.subtitle) {
    const w = textWidth(input.subtitle, 9);
    ops.push(text(PAGE_WIDTH - MARGIN - w, PAGE_HEIGHT - 48, input.subtitle, 'F1', 9, '1 1 1'));
  }

  let y = PAGE_HEIGHT - HEADER_HEIGHT - 22;
  const summary = input.summary ?? [];
  if (summary.length > 0) {
    const colW = tableWidth / Math.min(summary.length, 4);
    summary.forEach(([label, value], i) => {
      const col = i % 4;
      const rowY = y - Math.floor(i / 4) * 30;
      ops.push(text(MARGIN + col * colW, rowY, label.toUpperCase(), 'F1', 7, MUTED));
      ops.push(text(MARGIN + col * colW, rowY - 13, fitText(value, colW - 8, 11), 'F2', 11));
    });
    y -= Math.ceil(summary.length / 4) * 30 + 12;
  }

  ops.push(...drawTableHeader(y));
  y -= ROW_HEIGHT;

  if (input.rows.length === 0) {
    ops.push(text(MARGIN + cellPad, y - 14, input.emptyMessage ?? 'No records.', 'F1', 9, MUTED));
  }

  input.rows.forEach((row, index) => {
    if (y - ROW_HEIGHT < FOOTER_Y + 16) {
      pages.push(ops);
      ops = [];
      y = PAGE_HEIGHT - MARGIN;
      ops.push(...drawTableHeader(y));
      y -= ROW_HEIGHT;
    }
    if (index % 2 === 1) ops.push(rect(MARGIN, y - ROW_HEIGHT, tableWidth, ROW_HEIGHT, ZEBRA));
    row.forEach((cell, col) => {
      if (col < input.columns.length) ops.push(drawCell(cell ?? '', col, y - 12, 'F1'));
    });
    ops.push(line(MARGIN, y - ROW_HEIGHT, MARGIN + tableWidth, RULE));
    y -= ROW_HEIGHT;
  });
  pages.push(ops);

  // Footers need the final page count.
  pages.forEach((pageOps, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    pageOps.push(text(MARGIN, FOOTER_Y, 'Generated by AnchorPoint. For tax and accounting reference.', 'F1', 7, MUTED));
    pageOps.push(text(PAGE_WIDTH - MARGIN - textWidth(label, 7), FOOTER_Y, label, 'F1', 7, MUTED));
  });

  return assemble(pages.map((p) => p.join('\n')));
}

/** Serialises content streams into a complete PDF with a valid xref table. */
function assemble(contentStreams: string[]): string {
  // Object numbering: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold,
  // then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = contentStreams.map((_, i) => 5 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  contentStreams.forEach((stream, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return out;
}
