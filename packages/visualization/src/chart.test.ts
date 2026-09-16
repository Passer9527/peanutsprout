/**
 * 花生苗数据库管理工具 - 图表 SQL 生成测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这里的用例大多来自真实缺陷：早期 buildChartSql 生成的 SQL **没有 FROM 子句**，
 * 表面上"测试通过"（只断言了 GROUP BY），实际一条都跑不通。
 */

import { describe, expect, it } from 'vitest';
import { PeanutError, type ChartConfig } from '@peanutsprout/core';
import { CHART_FILTER_OPERATORS, buildChartSql, validateChartConfig } from './chart.js';

const base: ChartConfig = {
  dimensions: [{ column: 'region', aggregation: 'none' }],
  metrics: [{ column: 'amount', aggregation: 'sum', alias: 'total' }],
};

describe('buildChartSql', () => {
  it('生成的 SQL 必须带 FROM 子句（回归：曾经完全没有 FROM）', () => {
    const sql = buildChartSql(base, { table: 'orders', schema: 'main' });
    expect(sql).toContain('FROM "main"."orders"');
    expect(sql).toContain('SELECT "region", SUM("amount") AS "total"');
    expect(sql).toContain('GROUP BY "region"');
    // 段落顺序必须是 SELECT → FROM → GROUP BY
    const idxSelect = sql.indexOf('SELECT');
    const idxFrom = sql.indexOf('FROM');
    const idxGroup = sql.indexOf('GROUP BY');
    expect(idxSelect).toBeLessThan(idxFrom);
    expect(idxFrom).toBeLessThan(idxGroup);
  });

  it('没有来源表时明确报错，而不是生成跑不通的 SQL', () => {
    expect(() => buildChartSql(base, {})).toThrow(/来源表/);
    expect(() => buildChartSql(base, { table: '   ' })).toThrow(/来源表/);
  });

  it('schema 为空时不加限定', () => {
    const sql = buildChartSql(base, { table: 'orders' });
    expect(sql).toContain('FROM "orders"');
    expect(sql).not.toContain('"main"');
  });

  it('MySQL 方言使用反引号（回归：MySQL 未开 ANSI_QUOTES 会语法错误）', () => {
    const sql = buildChartSql(base, { table: 'orders', schema: 'shop', quoteStyle: 'mysql' });
    expect(sql).toContain('FROM `shop`.`orders`');
    expect(sql).toContain('SELECT `region`, SUM(`amount`) AS `total`');
    expect(sql).not.toContain('"');
  });

  it('筛选运算符同时接受 SQL 风格与缩写风格', () => {
    const eq = buildChartSql({ ...base, filters: [{ column: 'status', operator: '=', value: 'paid' }] }, { table: 't' });
    expect(eq).toContain(`WHERE "status" = 'paid'`);

    const eqAlias = buildChartSql({ ...base, filters: [{ column: 'status', operator: 'eq', value: 'paid' }] }, { table: 't' });
    expect(eqAlias).toContain(`WHERE "status" = 'paid'`);

    const isNull = buildChartSql({ ...base, filters: [{ column: 'memo', operator: 'is_null', value: null }] }, { table: 't' });
    expect(isNull).toContain('WHERE "memo" IS NULL');

    const inList = buildChartSql({ ...base, filters: [{ column: 'region', operator: 'in', value: ['华东', '华南'] }] }, { table: 't' });
    expect(inList).toContain(`WHERE "region" IN ('华东', '华南')`);
  });

  it('导出的运算符清单与生成器实现一致', () => {
    for (const op of CHART_FILTER_OPERATORS) {
      if (op === 'in') {
        expect(() => buildChartSql({ ...base, filters: [{ column: 'c', operator: op, value: [1] }] }, { table: 't' })).not.toThrow();
      } else if (op === 'is null' || op === 'is not null') {
        expect(() => buildChartSql({ ...base, filters: [{ column: 'c', operator: op, value: null }] }, { table: 't' })).not.toThrow();
      } else {
        expect(() => buildChartSql({ ...base, filters: [{ column: 'c', operator: op, value: 1 }] }, { table: 't' })).not.toThrow();
      }
    }
    // 未在清单里的运算符必须被拒
    expect(() =>
      buildChartSql({ ...base, filters: [{ column: 'c', operator: 'drop_table', value: 1 }] }, { table: 't' }),
    ).toThrow(/不支持的筛选运算符/);
  });

  it('字段名注入被白名单拦下', () => {
    expect(() =>
      buildChartSql(
        { dimensions: [{ column: 'region"; DROP TABLE users; --', aggregation: 'none' }], metrics: [] },
        { table: 't' },
      ),
    ).toThrow(/非法字符/);
    expect(() => buildChartSql(base, { table: 'orders; DROP TABLE users' })).toThrow(/非法/);
  });

  it('字符串字面量中的单引号被转义', () => {
    const sql = buildChartSql(
      { ...base, filters: [{ column: 'name', operator: 'like', value: "O'Brien%" }] },
      { table: 't' },
    );
    expect(sql).toContain("'O''Brien%'");
  });

  it('limit 优先取配置值，其次取选项值，非法值报错', () => {
    expect(buildChartSql({ ...base, limit: 5 }, { table: 't', limit: 99 })).toContain('LIMIT 5');
    expect(buildChartSql(base, { table: 't', limit: 99 })).toContain('LIMIT 99');
    expect(() => buildChartSql({ ...base, limit: 0 }, { table: 't' })).toThrow(/limit 非法/);
    expect(() => buildChartSql({ ...base, limit: 1_000_000 }, { table: 't' })).toThrow(/limit 非法/);
  });

  it('排序只接受结构化输入', () => {
    const sql = buildChartSql(
      { ...base, sort: [{ column: 'total', direction: 'desc' }] },
      { table: 't' },
    );
    expect(sql).toContain('ORDER BY "total" DESC');
  });

  it('既无维度也无指标时报错', () => {
    expect(() => buildChartSql({ dimensions: [], metrics: [] }, { table: 't' })).toThrow(/至少需要一个维度或指标/);
  });
});

/**
 * 回归：MySQL 系连接默认把反斜杠当字符串转义符，旧实现只翻倍单引号，
 * 于是筛选值 `\' UNION SELECT ...` 会提前闭合字符串（注入），
 * 更常见的 `C:\path` 也会直接语法错误。这里同时钉死两种方言的行为。
 */
describe('筛选值字面量按方言转义', () => {
  const sqlFor = (value: unknown, quoteStyle: 'standard' | 'mysql'): string =>
    buildChartSql(
      { ...base, filters: [{ column: 'name', operator: '=', value }] },
      { table: 't', quoteStyle },
    );

  it('标准方言只翻倍单引号，反斜杠原样保留（PostgreSQL/SQLite 不把 \\ 当转义符）', () => {
    // 标准方言若也翻倍反斜杠，会把用户数据 `C:\tmp` 写成 `C:\\tmp`，属于静默写坏数据
    expect(sqlFor(String.raw`C:\tmp`, 'standard')).toContain(String.raw`'C:\tmp'`);
    expect(sqlFor("O'Brien", 'standard')).toContain(`'O''Brien'`);
    expect(sqlFor(String.raw`a\'b`, 'standard')).toContain(String.raw`'a\''b'`);
  });

  it('MySQL 方言先把反斜杠翻倍，再翻倍单引号（顺序不能反）', () => {
    expect(sqlFor(String.raw`C:\tmp`, 'mysql')).toContain(String.raw`'C:\\tmp'`);
    expect(sqlFor("O'Brien", 'mysql')).toContain(`'O''Brien'`);
    expect(sqlFor(String.raw`a\'b`, 'mysql')).toContain(String.raw`'a\\''b'`);
  });

  it('MySQL 方言下「反斜杠+单引号」载荷无法越出字符串', () => {
    const payload = String.raw`\'; DROP TABLE users; --`;
    const sql = sqlFor(payload, 'mysql');
    const escapedLiteral = String.raw`'\\''; DROP TABLE users; --'`;
    expect(sql).toContain(escapedLiteral);
    // 字面量之后应当直接换行/结束；若只翻倍单引号，DROP 会落在字符串外
    const after = sql.slice(sql.indexOf(escapedLiteral) + escapedLiteral.length);
    expect(after.startsWith('\n') || after.startsWith(';')).toBe(true);
    // 旧实现（只翻倍单引号）会生成 `'\'';`，即反斜杠逃逸掉收尾引号
    expect(sql).not.toContain(String.raw`'\'';`);
  });

  it('in 列表里的每个值同样按方言转义', () => {
    const sql = buildChartSql(
      { ...base, filters: [{ column: 'region', operator: 'in', value: ['a\\', "b'c"] }] },
      { table: 't', quoteStyle: 'mysql' },
    );
    expect(sql).toContain(String.raw`IN ('a\\', 'b''c')`);
  });
});

/**
 * 回归：median 曾经被映射成 AVG(expr) AS median_xxx —— 界面选「中位数」拿到
 * 平均值，列名却伪装成 median_*，是比报错更危险的静默数据错误。
 * 由于拿不到目标方言、没有统一安全的写法，这里选择显式报错。
 */
describe('median 聚合不再用 AVG 冒充', () => {
  const medianConfig: ChartConfig = {
    dimensions: [{ column: 'region', aggregation: 'none' }],
    metrics: [{ column: 'amount', aggregation: 'median' }],
  };

  it('buildChartSql 对 median 显式报错，且不生成 AVG', () => {
    expect(() => buildChartSql(medianConfig, { table: 't' })).toThrow(/中位数/);
    try {
      buildChartSql(medianConfig, { table: 't' });
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as PeanutError).code).toBe('VALIDATION_FAILED');
      expect((e as Error).message).not.toContain('AVG');
    }
  });

  it('validateChartConfig 把 median 记为错误，创建/保存时即被拒绝', () => {
    const result = validateChartConfig('column', medianConfig);
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toMatch(/median|中位数/);
  });
});

/**
 * 回归：`aggregation:'none'` 的字段别名曾被丢弃（AGG_SQL.none 忽略 alias、
 * 维度分支直接 quote(column)），于是返回列名与配置不符，按别名排序更会
 * `ORDER BY "不存在的列"` 直接报错。别名必须对所有聚合方式生效。
 */
describe("aggregation='none' 时别名必须生效", () => {
  it('none + 显式别名生成 AS，未显式指定别名时保持默认列名', () => {
    const withAlias = buildChartSql(
      { dimensions: [], metrics: [{ column: 'amount', aggregation: 'none', alias: 'total' }] },
      { table: 't' },
    );
    expect(withAlias).toContain('SELECT "amount" AS "total"');

    const withoutAlias = buildChartSql(
      { dimensions: [{ column: 'region', aggregation: 'none' }], metrics: [] },
      { table: 't' },
    );
    // 默认列名不能被改成 none_region，否则历史图表全部改名
    expect(withoutAlias).toContain('SELECT "region"');
    expect(withoutAlias).not.toContain(' AS ');
  });

  it('none + 别名 + 按别名排序时，ORDER BY 引用的列确实存在', () => {
    const sql = buildChartSql(
      {
        dimensions: [],
        metrics: [{ column: 'amount', aggregation: 'none', alias: 'total' }],
        sort: [{ column: 'total', direction: 'desc' }],
      },
      { table: 't' },
    );
    expect(sql).toContain('SELECT "amount" AS "total"');
    expect(sql).toContain('ORDER BY "total" DESC');
  });

  it('维度 none + 别名同样生效，MySQL 方言用反引号', () => {
    const sql = buildChartSql(
      { dimensions: [{ column: 'region', aggregation: 'none', alias: 'r' }], metrics: [{ column: 'amount', aggregation: 'sum' }] },
      { table: 't', quoteStyle: 'mysql' },
    );
    expect(sql).toContain('SELECT `region` AS `r`, SUM(`amount`) AS `sum_amount`');
  });
});

describe('validateChartConfig', () => {
  it('按图表类型校验最低维度/指标数', () => {
    // bar 需要 1 维度 + 1 指标
    expect(validateChartConfig('bar', base).ok).toBe(true);
    const missingMetric = validateChartConfig('bar', { dimensions: base.dimensions, metrics: [] });
    expect(missingMetric.ok).toBe(false);
    expect(missingMetric.errors.join('')).toMatch(/至少需要 1 个指标/);

    // scatter 需要 2 维度
    const scatter = validateChartConfig('scatter', base);
    expect(scatter.ok).toBe(false);
    expect(scatter.errors.join('')).toMatch(/至少需要 2 个维度/);
  });

  it('维度上用了聚合、指标没聚合时给出警告而不是错误', () => {
    const result = validateChartConfig('bar', {
      dimensions: [{ column: 'region', aggregation: 'sum' }],
      metrics: [{ column: 'amount', aggregation: 'none' }],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBe(2);
  });

  it('非法字段名进入 errors', () => {
    const result = validateChartConfig('bar', {
      dimensions: [{ column: 'a b', aggregation: 'none' }],
      metrics: [{ column: 'amount', aggregation: 'sum' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toMatch(/非法字符/);
  });

  it('不支持的图表类型抛错', () => {
    expect(() => validateChartConfig('nope' as never, base)).toThrow(/不支持的图表类型/);
  });

  /**
   * 回归：alias 与 filters[].column 以前不校验，保存接口一律放行，
   * 于是能存下"保存成功但每次取数都失败"的图表，用户无从判断原因。
   */
  it('非法别名、非法筛选列与运算符在保存前就报错', () => {
    const result = validateChartConfig('column', {
      dimensions: [{ column: 'region', aggregation: 'none' }],
      metrics: [{ column: 'amount', aggregation: 'sum', alias: 'total; DROP TABLE users' }],
      filters: [
        { column: 'bad col', operator: '=', value: 1 },
        { column: 'status', operator: 'drop_table', value: 1 },
        { column: 'region', operator: 'in', value: [] },
      ],
    });
    expect(result.ok).toBe(false);
    const text = result.errors.join('\n');
    expect(text).toMatch(/别名含非法字符/);
    expect(text).toMatch(/筛选列名含非法字符/);
    expect(text).toMatch(/不支持的筛选运算符/);
    expect(text).toMatch(/非空数组/);
  });

  it('合法别名（含中文）与缩写运算符不会被误报', () => {
    const result = validateChartConfig('column', {
      dimensions: [{ column: 'region', aggregation: 'none' }],
      metrics: [{ column: 'amount', aggregation: 'sum', alias: '总额' }],
      // eq 是 '=' 的历史缩写写法，生成器接受，校验也必须接受
      filters: [{ column: 'status', operator: 'eq', value: 'paid' }],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
