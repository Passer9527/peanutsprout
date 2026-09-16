/**
 * CSV 导入字面量转换测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 重点回归"绝不猜类型"：导入路径拿不到列类型，任何按内容猜测都会造成静默数据损坏。
 */

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { parseCsv, sqlLiteral } from './index.js';

describe('sqlLiteral', () => {
  it('数字形态的文本保持字符串：前导零不丢', () => {
    expect(sqlLiteral('01234')).toBe("'01234'");
  });

  it('超过 2^53 的大整数保持字符串：不变成科学计数法', () => {
    expect(sqlLiteral('98765432109876543210')).toBe("'98765432109876543210'");
  });

  it('true / false 保持字符串，不再变成布尔字面量', () => {
    expect(sqlLiteral('true')).toBe("'true'");
    expect(sqlLiteral('false')).toBe("'false'");
  });

  it('空字段写成空字符串而不是 NULL', () => {
    expect(sqlLiteral('')).toBe("''");
  });

  it('单引号翻倍转义，避免拼串注入', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral("'; DROP TABLE t; --")).toBe("'''; DROP TABLE t; --'");
  });

  it('只有显式给出 nullToken 时才写 NULL', () => {
    expect(sqlLiteral('\\N', '\\N')).toBe('NULL');
    // 未指定 nullToken 时，字面文本 \N 也必须原样当字符串
    expect(sqlLiteral('\\N')).toBe("'\\N'");
    // 空字符串与 nullToken 无关，永远写空字符串
    expect(sqlLiteral('', '\\N')).toBe("''");
  });

  // 用真实 node:sqlite 兜底验证：生成的 INSERT 写进 TEXT 列后必须原样保留，
  // 这正是旧实现静默损坏数据的三个实测场景（前导零/大整数/布尔文本）。
  it('生成的 INSERT 写进 TEXT 列后原样保留', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE t (v TEXT)');
      db.exec(
        `INSERT INTO t (v) VALUES (${sqlLiteral('01234')}), (${sqlLiteral('98765432109876543210')}), ` +
          `(${sqlLiteral('true')}), (${sqlLiteral('')})`,
      );
      const rows = db.prepare('SELECT v FROM t').all() as Array<{ v: string }>;
      expect(rows.map((row) => row.v)).toEqual(['01234', '98765432109876543210', 'true', '']);
    } finally {
      db.close();
    }
  });
});

describe('parseCsv', () => {
  it('支持双引号包裹、字段内逗号与 "" 转义', () => {
    expect(parseCsv('id,name\n1,"a,b"\n2,"he said ""hi"""\n')).toEqual([
      ['id', 'name'],
      ['1', 'a,b'],
      ['2', 'he said "hi"'],
    ]);
  });

  it('保留空字段为空字符串，并剥离 BOM', () => {
    expect(parseCsv('\uFEFFa,b\n1,\n')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });
});
