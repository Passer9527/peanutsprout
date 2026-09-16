/**
 * 花生苗数据库管理工具 - 零依赖 XLSX（Excel .xlsx）写入器
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计取舍（务必先读）：
 *
 * 1. 零运行时依赖。只用到 Node 内置能力，ZIP 容器按 **STORE（compression method 0，
 *    不压缩）** 手工拼装：本地文件头 + 中央目录 + EOCD，CRC32 自己算。
 *    这样既不引入 `adm-zip`/`jszip` 之类的第三方包（它们只是别人的传递依赖，
 *    本仓库并未声明，打包会崩），也不依赖 `node:zlib` 的 deflate 细节，
 *    出错面最小。代价是文件体积比压缩版大，对导出场景可接受。
 *
 * 2. 字符串一律写 `inlineStr`，**不生成 sharedStrings.xml**，少一层出错面。
 *
 * 3. 日期**真支持**：写成 Excel 序列号 + 自定义 `numFmt`（`xl/styles.xml` 中
 *    numFmtId=164，格式 `yyyy-mm-dd hh:mm:ss`），单元格带 `s="1"` 引用该样式。
 *    基准是 Excel 的 1899-12-30（已含 1900 闰年 bug 的历史偏移），
 *    故 serial = unixMillis / 86400000 + 25569。
 *    `new Date(NaN)` 这种非法日期无法表达为序列号，降级写成字符串 "Invalid Date"。
 *
 * 4. `Uint8Array`（含 `Buffer`）**不支持二进制**：xlsx 单元格没有 blob 类型，
 *    这里降级为 **base64 字符串**写入。需要还原时调用方自行 `Buffer.from(s, 'base64')`。
 *
 * 5. `buildXlsx([])` 视为调用方错误，抛 `PeanutError('VALIDATION_FAILED', ...)`。
 *    OOXML 工作簿必须至少有一个 sheet。
 */

import { PeanutError } from '@peanutsprout/core';

/** 一列的显示定义。 */
export interface XlsxColumn {
  /** 表头文字 */
  name: string;
  /** 可选的显示宽度提示（字符数），仅用于生成 col 宽度 */
  width?: number;
}

export type XlsxCellValue = string | number | boolean | null | undefined | Date | Uint8Array;

export interface XlsxSheet {
  /** 工作表名。Excel 限制：最长 31 字符，不能含 : \ / ? * [ ]，不能为空 */
  name: string;
  columns: XlsxColumn[];
  rows: XlsxCellValue[][];
}

/* ------------------------------------------------------------------ *
 * XML 工具
 * ------------------------------------------------------------------ */

/** XML 1.0 允许的字符之外的控制字符（含 \u0000-\u0008、\u000B、\u000C、\u000E-\u001F、\uFFFE、\uFFFF）。 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * 剔除 XML 1.0 不允许的字符。
 * Excel 对非法控制字符极其敏感，哪怕只有一个 \u0000 也会报“文件已损坏”。
 */
export function stripInvalidXmlChars(text: string): string {
  return text.replace(INVALID_XML_CHARS, '');
}

/**
 * XML 转义 + 控制字符剔除。
 * `&` 必须最先替换，否则会把后续生成的实体再转义一次。
 */
export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把 0 基列下标转成 Excel 列字母：0→A、25→Z、26→AA、27→AB、701→ZZ、702→AAA。 */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new PeanutError('VALIDATION_FAILED', `列下标必须是非负整数: ${String(index)}`);
  }
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 工作表名归一化
 * ------------------------------------------------------------------ */

/** Excel 禁止出现在工作表名里的字符。 */
const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;
/** Excel 工作表名长度上限。 */
const SHEET_NAME_MAX = 31;

/** 去掉首尾单引号（Excel 拒绝以 ' 开头或结尾的工作表名）。 */
function trimApostrophes(name: string): string {
  return name.replace(/^'+/, '').replace(/'+$/, '');
}

/**
 * 归一化单个工作表名：替换非法字符 → 去首尾单引号 → 截断到 31 字符 → 空则用兜底名。
 * 只做“单名合法化”，去重由 {@link resolveSheetNames} 负责。
 */
function normalizeSheetName(raw: unknown, fallback: string): string {
  let name = trimApostrophes(String(raw ?? '').replace(INVALID_SHEET_CHARS, '_'));
  if (name.length > SHEET_NAME_MAX) name = name.slice(0, SHEET_NAME_MAX);
  name = trimApostrophes(name);
  if (name.trim() === '') return fallback;
  return name;
}

/**
 * 批量归一化并去重。去重按 Excel 的规则大小写不敏感，冲突时追加 ` (2)`、` (3)`…
 * 追加后仍保证不超过 31 字符。
 */
export function resolveSheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const base = normalizeSheetName(sheets[i]?.name, `Sheet${i + 1}`);
    let candidate = base;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ` (${n})`;
      const room = Math.max(1, SHEET_NAME_MAX - suffix.length);
      candidate = trimApostrophes(base.slice(0, room)) + suffix;
      n += 1;
      if (n > 10_000) {
        // 理论上到不了；防御性兜底，避免死循环。
        candidate = `Sheet${i + 1}`;
        break;
      }
    }
    used.add(candidate.toLowerCase());
    out.push(candidate);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 单元格序列化
 * ------------------------------------------------------------------ */

/** Unix 毫秒 → Excel 序列号。25569 = 1970-01-01 的 Excel 序列号（含 1900 闰年 bug 偏移）。 */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

/** 日期单元格使用 styles.xml 中下标为 1 的 xf（numFmtId=164）。 */
const DATE_STYLE_INDEX = 1;

/** 判断是否是可以写成数字的有限数值。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 生成一个单元格的 XML。
 * @param ref 形如 `B7` 的显式引用，保证空值/跳过的单元格不会串位。
 */
function renderCell(ref: string, value: XlsxCellValue): string {
  // 空值：写自闭合空单元格，保留列位。
  if (value === null || value === undefined) return `<c r="${ref}"/>`;

  if (typeof value === 'string') {
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  if (isFiniteNumber(value)) {
    return `<c r="${ref}"><v>${String(value)}</v></c>`;
  }

  if (typeof value === 'number') {
    // NaN / ±Infinity：Excel 数值单元格无法表达，降级为字符串，避免生成损坏文件。
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">Invalid Date</t></is></c>`;
    }
    const serial = ms / MS_PER_DAY + EXCEL_EPOCH_OFFSET_DAYS;
    // 保留 9 位小数足够到毫秒精度，同时避免浮点尾数过长。
    const rounded = Math.round(serial * 1e9) / 1e9;
    return `<c r="${ref}" s="${DATE_STYLE_INDEX}"><v>${String(rounded)}</v></c>`;
  }

  if (value instanceof Uint8Array) {
    // 降级：xlsx 没有二进制单元格类型，这里写 base64 字符串。
    const base64 = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(base64)}</t></is></c>`;
  }

  // 运行期兜底（类型系统之外的脏数据）。
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

/* ------------------------------------------------------------------ *
 * 部件（part）生成
 * ------------------------------------------------------------------ */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** 生成 [Content_Types].xml，声明每个 sheet 与 styles 的 Override。 */
function contentTypesXml(sheetCount: number): string {
  const parts: string[] = [
    XML_DECL,
    `<Types xmlns="${NS_CONTENT_TYPES}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  ];
  for (let i = 1; i <= sheetCount; i++) {
    parts.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  }
  parts.push('</Types>');
  return parts.join('');
}

/** 包级关系：把 xl/workbook.xml 声明为 officeDocument。 */
function rootRelsXml(): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  );
}

/**
 * xl/workbook.xml。注意 `<sheet r:id>` 用的是**关系 id**（rId1…rIdN），
 * 而 `sheetId` 是工作表自身编号，两者不要混用。
 */
function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    XML_DECL +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    `<sheets>${sheets}</sheets>` +
    '</workbook>'
  );
}

/** xl/_rels/workbook.xml.rels：rId1..rIdN → sheet1..N，最后一个 rId 给 styles.xml。 */
function workbookRelsXml(sheetCount: number): string {
  const rels: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`,
    );
  }
  rels.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
  );
  return XML_DECL + `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}

/**
 * xl/styles.xml。最小可用集：1 个字体、2 个填充（Excel 要求至少 none + gray125）、
 * 1 个边框、2 个 cellXfs（下标 0 默认、下标 1 日期 numFmt 164）。
 */
function stylesXml(): string {
  return (
    XML_DECL +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
    '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="2">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

/** 生成一张工作表 XML。0 列 0 行的空表也是合法文件。 */
function sheetXml(sheet: XlsxSheet): string {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];

  let maxCols = columns.length;
  for (const row of rows) {
    if (Array.isArray(row) && row.length > maxCols) maxCols = row.length;
  }
  const maxRows = rows.length + 1; // 含表头
  const dimension =
    maxCols === 0 ? 'A1' : `A1:${columnLetter(maxCols - 1)}${maxRows}`;

  const out: string[] = [
    XML_DECL,
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`,
    `<dimension ref="${dimension}"/>`,
  ];

  // 列宽：只有显式给 width 的列才写 col。
  const colDefs: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const width = columns[i]?.width;
    if (isFiniteNumber(width) && width > 0) {
      colDefs.push(`<col min="${i + 1}" max="${i + 1}" width="${String(width)}" customWidth="1"/>`);
    }
  }
  if (colDefs.length > 0) out.push(`<cols>${colDefs.join('')}</cols>`);

  out.push('<sheetData>');

  // 第 1 行是表头。
  const headerCells: string[] = [];
  for (let c = 0; c < columns.length; c++) {
    const ref = `${columnLetter(c)}1`;
    headerCells.push(renderCell(ref, columns[c]?.name ?? ''));
  }
  out.push(`<row r="1">${headerCells.join('')}</row>`);

  // 数据行从第 2 行开始；逐格写显式引用，空值也不省略列位。
  for (let r = 0; r < rows.length; r++) {
    const rowIndex = r + 2;
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const cells: string[] = [];
    for (let c = 0; c < row.length; c++) {
      cells.push(renderCell(`${columnLetter(c)}${rowIndex}`, row[c] as XlsxCellValue));
    }
    out.push(`<row r="${rowIndex}">${cells.join('')}</row>`);
  }

  out.push('</sheetData></worksheet>');
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * 最小 ZIP 写入器（STORE，不压缩）
 * ------------------------------------------------------------------ */

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** 标准 CRC-32（IEEE 802.3，多项式 0xEDB88320）。 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** JS Date → DOS 日期/时间（MS-DOS 格式，年份范围 1980-2107）。 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = ((year - 1980) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: date & 0xffff };
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 拼装一个 STORE 模式的 ZIP 包：本地文件头 + 中央目录 + EOCD。 */
function buildZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const size = entry.data.length;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本 2.0
    local.writeUInt16LE(0x0800, 6); // 通用标志位：文件名为 UTF-8
    local.writeUInt16LE(0, 8); // 压缩方法 0 = STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // 压缩后大小（STORE 下等于原始大小）
    local.writeUInt32LE(size, 22); // 原始大小
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
    central.writeUInt16LE(20, 4); // 生成版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8); // 通用标志位：UTF-8
    central.writeUInt16LE(0, 10); // 压缩方法 STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // 扩展字段长度
    central.writeUInt16LE(0, 32); // 注释长度
    central.writeUInt16LE(0, 34); // 起始磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地文件头偏移
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD 签名
  eocd.writeUInt16LE(0, 4); // 当前磁盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘号
  eocd.writeUInt16LE(entries.length, 8); // 本磁盘条目数
  eocd.writeUInt16LE(entries.length, 10); // 条目总数
  eocd.writeUInt32LE(centralBuf.length, 12); // 中央目录大小
  eocd.writeUInt32LE(offset, 16); // 中央目录偏移
  eocd.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */

/**
 * 把若干工作表序列化成 .xlsx 二进制。
 *
 * - 工作表名会被自动修正（截断 / 替换非法字符 / 追加序号），不抛错。
 * - `sheets` 为空数组时抛 `PeanutError('VALIDATION_FAILED')`：OOXML 工作簿至少需要一个 sheet。
 */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new PeanutError('VALIDATION_FAILED', 'XLSX 至少需要 1 个工作表');
  }

  const names = resolveSheetNames(sheets);
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(sheets.length), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml(), 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(names), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(sheets.length), 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
  ];
  for (let i = 0; i < sheets.length; i++) {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(sheets[i]), 'utf8'),
    });
  }

  return buildZip(entries);
}
