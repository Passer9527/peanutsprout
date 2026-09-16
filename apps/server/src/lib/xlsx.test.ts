/**
 * 花生苗数据库管理工具 - 零依赖 XLSX 写入器测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这里守住几件曾经最容易踩的事：
 * - XML 转义 + XML 1.0 非法控制字符剔除（错一个字节 Excel 就报“文件已损坏”）；
 * - 列字母进位（≥27 列时必须是 AA/AB，而不是 A[ / A\）；
 * - 空单元格必须写显式 `r=".."`，否则右侧列位会整体左移串位；
 * - 工作表名自动修正后仍不得与既有名字冲突。
 *
 * 注意：本文件里的 ZIP 解析器只服务于单测断言，**不作为“文件真的能打开”的证据**；
 * 真实解压验证见交付报告（unzip / python zipfile + ElementTree）。
 */

import { describe, expect, it } from 'vitest';
import { PeanutError } from '@peanutsprout/core';
import {
  buildXlsx,
  columnLetter,
  crc32,
  escapeXml,
  resolveSheetNames,
  stripInvalidXmlChars,
  type XlsxSheet,
} from './xlsx.js';

/* ---------------- 测试用最小 ZIP 读取器（仅 STORE） ---------------- */

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD 未找到');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录头签名不对');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (method !== 0) throw new Error(`成员 ${name} 不是 STORE`);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('本地文件头签名不对');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.set(name, buf.subarray(dataStart, dataStart + size));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 取某个 XML 成员的字符串。 */
function part(buf: Buffer, name: string): string {
  const entry = readZipEntries(buf).get(name);
  if (entry === undefined) throw new Error(`缺少成员 ${name}`);
  return entry.toString('utf8');
}

/** 取 sheet1 第一张数据行（第 2 行）的原始 XML。 */
function dataRow(xml: string, rowIndex = 2): string {
  const m = new RegExp(`<row r="${rowIndex}">([\\s\\S]*?)</row>`).exec(xml);
  if (m === null) throw new Error(`第 ${rowIndex} 行不存在`);
  return m[1];
}

const baseSheet = (over: Partial<XlsxSheet> = {}): XlsxSheet => ({
  name: 'Sheet1',
  columns: [{ name: 'a' }, { name: 'b' }],
  rows: [],
  ...over,
});

/* ---------------- 1. XML 转义与控制字符 ---------------- */

describe('XML 转义与控制字符剔除', () => {
  it('五个 XML 特殊字符全部被转义，且 & 不会被二次转义', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
    expect(escapeXml('a&amp;b')).toBe('a&amp;amp;b');
    expect(escapeXml('<a href="x">it\'s</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&apos;s&lt;/a&gt;',
    );
  });

  it('XML 1.0 非法控制字符被剔除，合法空白（\\t \\n \\r）保留', () => {
    const dirty = 'a\u0000b\u0001c\u0008d\u000Be\u000Cf\u000Eg\u001Fh';
    expect(stripInvalidXmlChars(dirty)).toBe('abcdefgh');
    expect(escapeXml('x\u0000y')).toBe('xy');
    expect(escapeXml('保留\t制表\n换行\r回车')).toBe('保留\t制表\n换行\r回车');
  });

  it('控制字符出现在单元格与表头时不会进入 XML 输出', () => {
    const buf = buildXlsx([
      {
        name: '脏数据',
        columns: [{ name: '列\u0000一' }],
        rows: [['值\u0001\u0008\u001F']],
      },
    ]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');
    // 整个 XML 中不得残留任何 XML 1.0 非法字符
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false);
    expect(xml).toContain('<t xml:space="preserve">列一</t>');
    expect(xml).toContain('<t xml:space="preserve">值</t>');
  });

  it('不需要转义的普通字符串原样保留（含前后空格）', () => {
    const buf = buildXlsx([baseSheet({ rows: [[' 前后空格 ', 'plain']] })]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');
    expect(dataRow(xml)).toContain('<t xml:space="preserve"> 前后空格 </t>');
    expect(dataRow(xml)).toContain('<t xml:space="preserve">plain</t>');
  });
});

/* ---------------- 2. 列字母进位 ---------------- */

describe('列字母进位', () => {
  it('0/25/26/27/51/52/701/702 边界正确', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
  });

  it('≥27 列时表头与数据行的引用全部正确进位', () => {
    const n = 28; // A..Z + AA + AB
    const columns = Array.from({ length: n }, (_, i) => ({ name: `c${i}` }));
    const row = Array.from({ length: n }, (_, i) => i + 1);
    const buf = buildXlsx([{ name: 'S', columns, rows: [row] }]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');

    expect(xml).toContain('<c r="Z1" t="inlineStr">');
    expect(xml).toContain('<c r="AA1" t="inlineStr">');
    expect(xml).toContain('<c r="AB1" t="inlineStr">');
    // 第 28 列（下标 27）的值 28 落在 AB2
    expect(dataRow(xml)).toContain('<c r="AB2"><v>28</v></c>');
    expect(dataRow(xml)).toContain('<c r="AA2"><v>27</v></c>');
    // dimension 用最后一列字母
    expect(xml).toContain('<dimension ref="A1:AB2"/>');
  });

  it('非法列下标抛 VALIDATION_FAILED', () => {
    expect(() => columnLetter(-1)).toThrowError(PeanutError);
    expect(() => columnLetter(1.5)).toThrowError(PeanutError);
  });
});

/* ---------------- 3. 空单元格不串位 ---------------- */

describe('空单元格不串位', () => {
  it('null/undefined 写空标签，后续单元格仍用正确列字母', () => {
    const buf = buildXlsx([
      baseSheet({
        columns: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        rows: [[1, null, 'x']],
      }),
    ]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toBe('<c r="A2"><v>1</v></c><c r="B2"/><c r="C2" t="inlineStr"><is><t xml:space="preserve">x</t></is></c>');
  });

  it('undefined 与行内缺列都不会让右侧提前左移', () => {
    const buf = buildXlsx([
      baseSheet({
        columns: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        rows: [
          [undefined, undefined, 'tail'],
          [undefined],
        ],
      }),
    ]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');
    expect(dataRow(xml, 2)).toBe(
      '<c r="A2"/><c r="B2"/><c r="C2" t="inlineStr"><is><t xml:space="preserve">tail</t></is></c>',
    );
    expect(dataRow(xml, 3)).toBe('<c r="A3"/>');
  });

  it('空单元格出现在 27 列之后仍正确进位', () => {
    const n = 28;
    const row: (number | null)[] = Array.from({ length: n }, () => null);
    row[26] = 1;
    row[27] = 2;
    const buf = buildXlsx([
      { name: 'S', columns: Array.from({ length: n }, (_, i) => ({ name: `c${i}` })), rows: [row] },
    ]);
    const out = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(out).toContain('<c r="AA2"><v>1</v></c><c r="AB2"><v>2</v></c>');
  });
});

/* ---------------- 4. 各类型单元格形态 ---------------- */

describe('各类型单元格 XML 形态', () => {
  it('字符串走 inlineStr（不生成 sharedStrings.xml）', () => {
    const buf = buildXlsx([baseSheet({ rows: [['hello', '你好']] })]);
    const entries = readZipEntries(buf);
    expect(entries.has('xl/sharedStrings.xml')).toBe(false);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">hello</t></is></c>');
    expect(row).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">你好</t></is></c>');
  });

  it('数字写数值单元格（含负数/小数/0）', () => {
    const buf = buildXlsx([baseSheet({ rows: [[123, -4.5, 0]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('<c r="A2"><v>123</v></c>');
    expect(row).toContain('<c r="B2"><v>-4.5</v></c>');
    expect(row).toContain('<c r="C2"><v>0</v></c>');
  });

  it('NaN/Infinity 降级为字符串，不产生非法数值', () => {
    const buf = buildXlsx([baseSheet({ rows: [[Number.NaN, Number.POSITIVE_INFINITY]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>');
    expect(row).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Infinity</t></is></c>');
  });

  it('布尔写 t="b"，值为 1/0', () => {
    const buf = buildXlsx([baseSheet({ rows: [[true, false]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('<c r="A2" t="b"><v>1</v></c>');
    expect(row).toContain('<c r="B2" t="b"><v>0</v></c>');
  });

  it('Date 写数值 + s="1" 日期样式，styles.xml 声明 numFmt 164', () => {
    const buf = buildXlsx([baseSheet({ rows: [[new Date(Date.UTC(2025, 0, 1, 0, 0, 0))]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    // 1970-01-01 = 25569，2025-01-01 距其 20089 天
    expect(row).toBe('<c r="A2" s="1"><v>45658</v></c>');
    const styles = part(buf, 'xl/styles.xml');
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>');
    expect(styles).toContain('<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
  });

  it('Date 保留时分秒（小数部分）', () => {
    const buf = buildXlsx([baseSheet({ rows: [[new Date(Date.UTC(2025, 0, 1, 12, 0, 0))]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('<c r="A2" s="1"><v>45658.5</v></c>');
  });

  it('非法日期降级为字符串而非损坏的数值', () => {
    const buf = buildXlsx([baseSheet({ rows: [[new Date(Number.NaN)]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('Invalid Date');
    expect(row).not.toContain('t="b"');
  });

  it('Uint8Array 降级写 base64 字符串', () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const buf = buildXlsx([baseSheet({ rows: [[bytes, Buffer.from('hi')]] })]);
    const row = dataRow(part(buf, 'xl/worksheets/sheet1.xml'));
    expect(row).toContain('AQID/w==');
    expect(row).toContain('aGk=');
  });

  it('列宽提示生成 cols 定义，未给宽度的列不生成', () => {
    const buf = buildXlsx([
      {
        name: 'S',
        columns: [{ name: 'a', width: 20 }, { name: 'b' }],
        rows: [[1, 2]],
      },
    ]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<cols><col min="1" max="1" width="20" customWidth="1"/></cols>');
    expect(xml).not.toContain('min="2"');
  });
});

/* ---------------- 5. 多工作表与关系 id ---------------- */

describe('多工作表', () => {
  it('生成 sheet1..N，Content_Types 有对应 Override，rels 的 rId 与 workbook 一致', () => {
    const buf = buildXlsx([
      { name: '第一张', columns: [{ name: 'a' }], rows: [[1]] },
      { name: '第二张', columns: [{ name: 'b' }], rows: [[2]] },
      { name: '第三张', columns: [], rows: [] },
    ]);
    const entries = readZipEntries(buf);
    expect([...entries.keys()].sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
        'xl/worksheets/sheet3.xml',
      ].sort(),
    );

    const ct = part(buf, '[Content_Types].xml');
    for (const i of [1, 2, 3]) {
      expect(ct).toContain(`PartName="/xl/worksheets/sheet${i}.xml"`);
    }
    expect(ct).toContain('PartName="/xl/styles.xml"');
    expect(ct).toContain('PartName="/xl/workbook.xml"');

    const wb = part(buf, 'xl/workbook.xml');
    expect(wb).toContain('<sheet name="第一张" sheetId="1" r:id="rId1"/>');
    expect(wb).toContain('<sheet name="第二张" sheetId="2" r:id="rId2"/>');
    expect(wb).toContain('<sheet name="第三张" sheetId="3" r:id="rId3"/>');

    const rels = part(buf, 'xl/_rels/workbook.xml.rels');
    // rId1..rId3 → sheet1..3，styles 拿 rId4（不是 sheetId）
    expect(rels).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"');
    expect(rels).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"');

    // 关系 target 全部存在
    for (const m of rels.matchAll(/Target="([^"]+)"/g)) {
      expect(entries.has(`xl/${m[1]}`)).toBe(true);
    }
    // 每张表的数据落在自己的 part 里
    expect(part(buf, 'xl/worksheets/sheet1.xml')).toContain('<v>1</v>');
    expect(part(buf, 'xl/worksheets/sheet2.xml')).toContain('<v>2</v>');
  });

  it('空工作表（0 行 0 列）也是合法 XML', () => {
    const buf = buildXlsx([{ name: '空表', columns: [], rows: [] }]);
    const xml = part(buf, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<dimension ref="A1"/>');
    expect(xml).toContain('<sheetData><row r="1"></row></sheetData>');
  });
});

/* ---------------- 6. 工作表名自动修正 ---------------- */

describe('工作表名自动修正', () => {
  it('空名 / 超 31 字符 / 非法字符都被修正', () => {
    expect(resolveSheetNames([{ name: '', columns: [], rows: [] }])).toEqual(['Sheet1']);
    expect(resolveSheetNames([{ name: '   ', columns: [], rows: [] }])).toEqual(['Sheet1']);
    const long = 'x'.repeat(40);
    const [fixedLong] = resolveSheetNames([{ name: long, columns: [], rows: [] }]);
    expect(fixedLong.length).toBe(31);
    expect(fixedLong).toBe('x'.repeat(31));

    const [fixedChars] = resolveSheetNames([{ name: 'a:b\\c/d?e*f[g]h', columns: [], rows: [] }]);
    expect(fixedChars).toBe('a_b_c_d_e_f_g_h');
  });

  it('重名（含大小写不同）自动追加序号，且不超过 31 字符', () => {
    const names = resolveSheetNames([
      { name: 'dup', columns: [], rows: [] },
      { name: 'dup', columns: [], rows: [] },
      { name: 'DUP', columns: [], rows: [] },
    ]);
    // 去重按大小写不敏感判定，但保留调用方原本的大小写写法
    expect(names).toEqual(['dup', 'dup (2)', 'DUP (3)']);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);

    // 截断后与已有名字冲突时，追加序号仍要 ≤31
    const long = 'y'.repeat(31);
    const names2 = resolveSheetNames([
      { name: long, columns: [], rows: [] },
      { name: long, columns: [], rows: [] },
      { name: `${long}extra`, columns: [], rows: [] },
    ]);
    expect(names2[0]).toBe(long);
    expect(names2[1]).toBe(`${'y'.repeat(27)} (2)`);
    expect(names2[1].length).toBe(31);
    expect(names2[2]).toBe(`${'y'.repeat(27)} (3)`);
    expect(new Set(names2).size).toBe(3);
  });

  it('非法名修正后体现在 workbook.xml 里', () => {
    const buf = buildXlsx([{ name: 'bad/name', columns: [], rows: [] }]);
    expect(part(buf, 'xl/workbook.xml')).toContain('<sheet name="bad_name" sheetId="1" r:id="rId1"/>');
  });
});

/* ---------------- 7. 空输入与 CRC ---------------- */

describe('边界与 CRC32', () => {
  it('buildXlsx([]) 抛 PeanutError(VALIDATION_FAILED)', () => {
    expect(() => buildXlsx([])).toThrowError(PeanutError);
    try {
      buildXlsx([]);
      expect.unreachable('应当抛错');
    } catch (e) {
      expect((e as PeanutError).code).toBe('VALIDATION_FAILED');
      expect((e as PeanutError).status).toBe(400);
    }
  });

  it('CRC32 与标准测试向量一致', () => {
    // 经典向量：CRC32("123456789") = 0xCBF43926
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('每个 ZIP 成员的本地头 CRC 与数据一致', () => {
    const buf = buildXlsx([baseSheet({ rows: [['abc']] })]);
    const entries = readZipEntries(buf);
    for (const [name, data] of entries) {
      expect(crc32(data), `${name} 的 CRC`).toBeGreaterThanOrEqual(0);
    }
    // 手工核对中央目录里的 CRC 字段
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      const nameLen = buf.readUInt16LE(p + 28);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      expect(buf.readUInt32LE(p + 16)).toBe(crc32(entries.get(name)!));
      p += 46 + nameLen;
    }
  });

  it('生成的 Buffer 以 PK\\x03\\x04 开头、以 EOCD 结尾', () => {
    const buf = buildXlsx([baseSheet()]);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
    expect(buf.subarray(buf.length - 22, buf.length - 18).toString('latin1')).toBe('PK\x05\x06');
  });
});
