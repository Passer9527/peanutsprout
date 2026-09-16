/**
 * 花生苗数据库管理工具 - 脱敏网关与模型响应解析测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 脱敏是"数据出网前最后一道闸门"，必须保证：
 *  - 敏感列一定被替换，且原文不残留在行数据里；
 *  - 不敏感列不被误伤；
 *  - 发送 schema 时绝不夹带任何数据行。
 */

import { DEFAULT_REDACTION_RULES, type ColumnMeta } from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import { extractJson } from './provider.js';
import { RedactionGateway } from './redaction.js';

function cols(...names: string[]): ColumnMeta[] {
  return names.map((name) => ({ name, dataType: 'TEXT' }));
}

describe('RedactionGateway.redactRows', () => {
  const gw = new RedactionGateway(DEFAULT_REDACTION_RULES, true);

  it('密码列被置空', () => {
    const { rows } = gw.redactRows(cols('id', 'password', 'name'), [[1, 'hunter2', '张三']]);
    expect(rows[0]?.[1]).toBeNull();
    expect(rows[0]?.[2]).toBe('张三');
  });

  it('手机号按规则做部分保留', () => {
    const { rows } = gw.redactRows(cols('phone'), [['13800138000']]);
    const value = String(rows[0]?.[0] ?? '');
    expect(value).not.toBe('13800138000');
    expect(value.startsWith('138')).toBe(true);
    expect(value.endsWith('00')).toBe(true);
  });

  it('邮箱被掩码', () => {
    const { rows } = gw.redactRows(cols('email'), [['a@b.com']]);
    expect(rows[0]?.[0]).toBe('***');
  });

  it('列名匹配不区分大小写', () => {
    const { rows } = gw.redactRows(cols('USER_PASSWORD'), [['secret']]);
    expect(rows[0]?.[0]).toBeNull();
  });

  it('不敏感列保持原值', () => {
    const { rows } = gw.redactRows(cols('id', 'title', 'amount'), [[1, '标题', 9.9]]);
    expect(rows[0]).toEqual([1, '标题', 9.9]);
  });

  it('NULL 保持 NULL', () => {
    const { rows } = gw.redactRows(cols('phone'), [[null]]);
    expect(rows[0]?.[0]).toBeNull();
  });

  it('多行多列整体处理，原文不在结果中出现', () => {
    const { rows } = gw.redactRows(
      cols('id', 'password', 'email'),
      [
        [1, 'pw-one', 'a@x.com'],
        [2, 'pw-two', 'b@x.com'],
      ],
    );
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('pw-one');
    expect(serialized).not.toContain('pw-two');
    expect(serialized).not.toContain('a@x.com');
  });

  it('报告里列出命中的列与策略，便于审计', () => {
    const { report } = gw.redactRows(cols('id', 'password', 'email'), [[1, 'x', 'y']]);
    expect(report.redactedCells).toBe(2);
    expect(report.matchedColumns.sort()).toEqual(['email', 'password']);
    expect(report.appliedRules.find((r) => r.column === 'password')?.strategy).toBe('null');
  });

  it('关闭脱敏时原样返回（用于本地模型等可信场景）', () => {
    const off = new RedactionGateway(DEFAULT_REDACTION_RULES, false);
    const { rows, report } = off.redactRows(cols('password'), [['plain']]);
    expect(rows[0]?.[0]).toBe('plain');
    expect(report.redactedCells).toBe(0);
  });

  it('不修改传入的原始数组（避免副作用污染界面数据）', () => {
    const original = [[1, 'hunter2', '张三']] as (string | number | null)[][];
    gw.redactRows(cols('id', 'password', 'name'), original);
    expect(original[0]?.[1]).toBe('hunter2');
  });

  it('自定义规则可覆盖默认规则', () => {
    const custom = new RedactionGateway([{ columnPattern: '*title*', strategy: 'null' }], true);
    expect(custom.ruleFor('title')).not.toBeNull();
    expect(custom.ruleFor('password')).toBeNull();
  });

  it('per-call enabled 覆盖构造开关：同一个网关可以按次开关', () => {
    // 构造时开着，但这次显式关闭 —— 必须原样返回
    const on = new RedactionGateway(DEFAULT_REDACTION_RULES, true);
    const a = on.redactRows(cols('password'), [['plain']], false);
    expect(a.rows[0]?.[0]).toBe('plain');
    expect(a.report.redactedCells).toBe(0);
    expect(a.report.matchedColumns).toEqual([]);

    // 构造时关着，但这次显式开启 —— 必须真的脱敏
    const off = new RedactionGateway(DEFAULT_REDACTION_RULES, false);
    const b = off.redactRows(cols('password'), [['plain']], true);
    expect(b.rows[0]?.[0]).toBeNull();
    expect(b.report.redactedCells).toBe(1);
    // 缺省时仍沿用构造开关
    expect(off.defaultEnabled).toBe(false);
    expect(on.defaultEnabled).toBe(true);
  });
});

describe('RedactionGateway.describeSchema', () => {
  const gw = new RedactionGateway(DEFAULT_REDACTION_RULES, true);

  it('只输出表与列结构，不包含任何数据行', () => {
    const text = gw.describeSchema([{ name: 'users', comment: '用户表' }], {
      users: [
        {
          schema: 'main',
          table: 'users',
          name: 'id',
          dataType: 'INTEGER',
          nullable: false,
          defaultValue: null,
          comment: null,
          isPrimaryKey: true,
          ordinal: 1,
        },
        {
          schema: 'main',
          table: 'users',
          name: 'email',
          dataType: 'TEXT',
          nullable: true,
          defaultValue: null,
          comment: '邮箱',
          isPrimaryKey: false,
          ordinal: 2,
        },
      ],
    });
    expect(text).toContain('users');
    expect(text).toContain('用户表');
    expect(text).toContain('id');
    expect(text).toContain('email');
    expect(text).toContain('PK');
    expect(text).toContain('邮箱');
  });

  it('没有 schema 上下文时给出明确占位', () => {
    expect(gw.describeSchema([], {})).toBe('');
  });
});

describe('extractJson（模型输出容错解析）', () => {
  it('直接解析纯 JSON', () => {
    expect(extractJson('{"sql":"SELECT 1"}')).toEqual({ sql: 'SELECT 1' });
  });

  it('解析 ```json 代码块包裹的 JSON', () => {
    expect(extractJson('```json\n{"sql":"SELECT 1"}\n```')).toEqual({ sql: 'SELECT 1' });
  });

  it('解析 ``` 无语言标记的代码块', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('从前后夹杂解释文字中提取 JSON', () => {
    expect(extractJson('好的，这是结果：{"sql":"SELECT 1"} 希望有帮助')).toEqual({ sql: 'SELECT 1' });
  });

  it('无法解析时返回 null 而不是抛错', () => {
    expect(extractJson('完全没有 JSON')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('不误吞数组等非对象结构', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });
});
