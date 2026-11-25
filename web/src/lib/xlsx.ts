/**
 * Tiny dependency-free XLSX writer.
 *
 * Only the subset the workbench needs: one worksheet, inline strings, per-cell
 * fills / fonts / borders, merged cells and a frozen pane. Everything is
 * written as a store-only ZIP, so no compression library is required.
 */

export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** Text colour, `#rrggbb`. */
  color?: string;
  /** Solid fill colour, `#rrggbb`. */
  fill?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
  middle?: boolean;
  wrap?: boolean;
  /** Per-side border colours, `#rrggbb`. */
  border?: { top?: string; right?: string; bottom?: string; left?: string };
}

export interface XCell {
  v: string | number | null | undefined;
  s?: XStyle;
}

export interface XRow {
  cells: XCell[];
  height?: number;
}

export interface XSheet {
  name: string;
  columns: Array<{ width: number }>;
  rows: XRow[];
  /** e.g. 'A1:H1' */
  merges?: string[];
  freeze?: { xSplit?: number; ySplit?: number; topLeft: string };
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/** `#rgb` / `#rrggbb` / `#aarrggbb` → `FFRRGGBB`. */
function argb(color: string): string {
  const value = color.replace('#', '').trim();
  if (/^[0-9a-fA-F]{8}$/.test(value)) return value.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `FF${value.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value.split('');
    return `FF${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return 'FF000000';
}

function colLetter(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

class StyleBook {
  fonts: string[] = [];
  private fontKeys = new Map<string, number>();
  fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  private fillKeys = new Map<string, number>();
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private borderKeys = new Map<string, number>();
  xfs: string[] = [];
  private xfKeys = new Map<string, number>();

  constructor(fontName: string, color: string) {
    const base = `<font><sz val="10"/><color rgb="${argb(color)}"/><name val="${xmlEscape(
      fontName,
    )}"/></font>`;
    this.fonts.push(base);
    this.fontKeys.set('base', 0);
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  }

  fontId(style: XStyle, fontName: string): number {
    const size = style.size ?? 10;
    const color = style.color ?? '#1f2329';
    const key = [fontName, size, color, style.bold, style.italic, style.strike].join('|');
    const cached = this.fontKeys.get(key);
    if (cached !== undefined) return cached;
    const parts = [
      `<font><sz val="${size}"/>`,
      `<color rgb="${argb(color)}"/>`,
      `<name val="${xmlEscape(fontName)}"/>`,
      style.bold ? '<b/>' : '',
      style.italic ? '<i/>' : '',
      style.strike ? '<strike/>' : '',
      '</font>',
    ].join('');
    const id = this.fonts.length;
    this.fonts.push(parts);
    this.fontKeys.set(key, id);
    return id;
  }

  fillId(style: XStyle): number {
    if (!style.fill) return 0;
    const key = argb(style.fill);
    const cached = this.fillKeys.get(key);
    if (cached !== undefined) return cached;
    const id = this.fills.length;
    this.fills.push(
      `<fill><patternFill patternType="solid"><fgColor rgb="${key}"/><bgColor indexed="64"/></patternFill></fill>`,
    );
    this.fillKeys.set(key, id);
    return id;
  }

  borderId(style: XStyle): number {
    const border = style.border;
    if (!border) return 0;
    const sides: Array<'left' | 'right' | 'top' | 'bottom'> = ['left', 'right', 'top', 'bottom'];
    if (!sides.some((side) => border[side])) return 0;
    const key = sides.map((side) => `${side}:${border[side] ?? ''}`).join('|');
    const cached = this.borderKeys.get(key);
    if (cached !== undefined) return cached;
    const xml = sides
      .map((side) =>
        border[side]
          ? `<${side} style="thin"><color rgb="${argb(border[side]!)}"/></${side}>`
          : `<${side}/>`,
      )
      .join('');
    const id = this.borders.length;
    this.borders.push(`<border>${xml}<diagonal/></border>`);
    this.borderKeys.set(key, id);
    return id;
  }

  styleId(style: XStyle | undefined, fontName: string): number {
    if (!style) return 0;
    const fontId = this.fontId(style, fontName);
    const fillId = this.fillId(style);
    const borderId = this.borderId(style);
    const align =
      style.align || style.middle || style.wrap
        ? `<alignment${style.align ? ` horizontal="${style.align}"` : ''}${
            style.middle ? ' vertical="center"' : ''
          }${style.wrap ? ' wrapText="1"' : ''}/>`
        : '';
    const key = `${fontId}|${fillId}|${borderId}|${align}`;
    const cached = this.xfKeys.get(key);
    if (cached !== undefined) return cached;
    const id = this.xfs.length;
    this.xfs.push(
      `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${
        align ? ' applyAlignment="1"' : ''
      }>${align}</xf>`,
    );
    this.xfKeys.set(key, id);
    return id;
  }

  toXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>
<fills count="${this.fills.length}">${this.fills.join('')}</fills>
<borders count="${this.borders.length}">${this.borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }
}

function sheetXml(sheet: XSheet, stylebook: StyleBook, fontName: string): string {
  const rows: string[] = [];

  sheet.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 1;
    const cells: string[] = [];
    row.cells.forEach((cell, colIndex) => {
      if (cell === undefined || cell === null) return;
      const value = cell.v;
      if (value === null || value === undefined || value === '') {
        // Still emit an empty styled cell so fills/borders show up.
        if (!cell.s) return;
        cells.push(`<c r="${colLetter(colIndex)}${r}" s="${stylebook.styleId(cell.s, fontName)}"/>`);
        return;
      }
      const style = cell.s ? ` s="${stylebook.styleId(cell.s, fontName)}"` : '';
      if (typeof value === 'number') {
        cells.push(`<c r="${colLetter(colIndex)}${r}"${style}><v>${value}</v></c>`);
      } else {
        cells.push(
          `<c r="${colLetter(colIndex)}${r}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            value,
          )}</t></is></c>`,
        );
      }
    });
    const height = row.height ? ` ht="${row.height}" customHeight="1"` : '';
    rows.push(`<row r="${r}"${height}>${cells.join('')}</row>`);
  });

  const cols = sheet.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
    )
    .join('');

  const freeze = sheet.freeze
    ? `<pane${sheet.freeze.xSplit ? ` xSplit="${sheet.freeze.xSplit}"` : ''}${
        sheet.freeze.ySplit ? ` ySplit="${sheet.freeze.ySplit}"` : ''
      } topLeftCell="${sheet.freeze.topLeft}" activePane="bottomRight" state="frozen"/>`
    : '';

  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join('')}</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView showGridLines="0" workbookViewId="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows.join('')}</sheetData>
${merges}
<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
</worksheet>`;
}

/* -------------------------------------------------------------------------- */
/* ZIP (store only)                                                           */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate =
    ((Math.max(1980, now.getFullYear()) - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    parts.push(local, file.data);

    const entry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);

    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const all = [...parts, ...central, end];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** Build a single-sheet workbook as a downloadable blob. */
export function buildXlsxBlob(sheet: XSheet, fontName = 'Microsoft YaHei'): Blob {
  const stylebook = new StyleBook(fontName, '#1f2329');
  const worksheet = sheetXml(sheet, stylebook, fontName);
  const encoder = new TextEncoder();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheet.name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(stylebook.toXml()) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(worksheet) },
  ];

  // Copy into a plain ArrayBuffer: BlobPart rejects a Uint8Array view whose
  // backing store is typed as ArrayBufferLike.
  const bytes = zipStore(files);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);

  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
