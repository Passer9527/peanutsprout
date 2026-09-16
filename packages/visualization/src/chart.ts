/**
 * 花生苗数据库管理工具 - 图表聚合与配置校验
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本模块只做"配置 → SQL"与"配置合法性"两件事，不含任何渲染代码：
 * 渲染在 Web 端（packages/visualization 的浏览器实现）完成，
 * 这样维度/指标/聚合的口径在桌面端与 Web 端完全一致。
 */

import {
  CHART_TYPES,
  PeanutError,
  type Aggregation,
  type ChartConfig,
  type ChartField,
  type ChartType,
  type ChartTypeInfo,
} from '@peanutsprout/core';

export function listChartTypes(): readonly ChartTypeInfo[] {
  return CHART_TYPES;
}

export function getChartTypeInfo(type: ChartType): ChartTypeInfo {
  const found = CHART_TYPES.find((t) => t.type === type);
  if (!found) {
    throw new PeanutError('VALIDATION_FAILED', `不支持的图表类型: ${String(type)}`, {
      supported: CHART_TYPES.map((t) => t.type),
    });
  }
  return found;
}

/**
 * 当前**真正实现**的聚合方式。这里刻意没有 median：
 *   历史实现把 median 映射成 `AVG(expr)`，界面选「中位数」拿到的却是平均值，
 *   而且列名仍伪装成 median_*，属于静默数据错误（比报错更危险）。
 *   各目标方言没有统一且安全的写法（PERCENTILE_CONT 在 MySQL/SQLite 不存在，
 *   窗口函数方案又需要重构整条 SQL），而 buildChartSql 目前只拿到引号风格、
 *   拿不到目标方言，因此宁可不支持并显式报错，也不用 AVG 冒充中位数。
 * 未列出的聚合值会在 fieldExpr / validateChartConfig 里被明确拒绝。
 */
const SUPPORTED_AGGREGATIONS: readonly Aggregation[] = [
  'none',
  'sum',
  'avg',
  'count',
  'count_distinct',
  'min',
  'max',
];

export { SUPPORTED_AGGREGATIONS };

// Partial 是有意的：median 这个键**故意不存在**，取到 undefined 时必须报错而不是降级
const AGG_SQL: Partial<Record<Aggregation, (expr: string, alias: string) => string>> = {
  none: (expr, alias) => `${expr} AS ${alias}`,
  sum: (expr, alias) => `SUM(${expr}) AS ${alias}`,
  avg: (expr, alias) => `AVG(${expr}) AS ${alias}`,
  count: (_expr, alias) => `COUNT(*) AS ${alias}`,
  count_distinct: (expr, alias) => `COUNT(DISTINCT ${expr}) AS ${alias}`,
  min: (expr, alias) => `MIN(${expr}) AS ${alias}`,
  max: (expr, alias) => `MAX(${expr}) AS ${alias}`,
  // median 明确留空：绝不能再用 AVG 冒充中位数，见 SUPPORTED_AGGREGATIONS 的说明
};

const SAFE_IDENT = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

/** 列名会被拼进 SQL，必须先做白名单校验（与驱动侧同一套规则）。 */
function assertIdentifier(name: string, what: string): string {
  if (!SAFE_IDENT.test(name)) {
    throw new PeanutError('VALIDATION_FAILED', `${what}含非法字符: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * 标识符引号风格：标准双引号（SQLite/PostgreSQL/Oracle…）与 MySQL 反引号。
 * 生成图表 SQL 时必须按**目标连接**的方言来选，否则在 MySQL 上会因
 * 未开启 ANSI_QUOTES 而报语法错误。
 */
export type ChartQuoteStyle = 'standard' | 'mysql';

function quote(name: string, style: ChartQuoteStyle = 'standard'): string {
  const safe = assertIdentifier(name, '字段名');
  return style === 'mysql' ? `\`${safe.replace(/`/g, '``')}\`` : `"${safe.replace(/"/g, '""')}"`;
}

/**
 * 生成单个字段的 SELECT 表达式。
 *
 * 别名对所有聚合方式都生效：旧实现里 `AGG_SQL.none` 直接返回 expr、维度分支也
 * 直接 quote(column)，于是 `aggregation:'none'` 的 alias 被静默丢弃 ——
 * 返回列名与配置不符，若再按别名排序就会 `ORDER BY "不存在的列"` 直接报错。
 * 未显式提供 alias 时保持既有默认列名（不加 AS），避免改变历史图表的行为。
 */
function fieldExpr(field: ChartField, style: ChartQuoteStyle): string {
  const column = quote(field.column, style);
  const explicitAlias = field.alias && field.alias.trim().length > 0 ? field.alias : undefined;
  // 中位数要单独给出可操作的错误说明：历史上它会静默返回平均值，
  // 用户看到 median_* 列名却拿到 mean，必须让这条路径显式失败。
  if (field.aggregation === 'median') {
    throw new PeanutError(
      'VALIDATION_FAILED',
      '暂不支持中位数（median）聚合：请改用 avg / min / max，或在图表中使用自定义 SQL，避免得到错误的统计结果',
      { aggregation: field.aggregation, supported: SUPPORTED_AGGREGATIONS },
    );
  }
  // 未聚合且未指定别名时保持裸列名（回归：默认列名不能被改成 none_xxx）
  if (field.aggregation === 'none' && !explicitAlias) return column;
  const rawAlias = explicitAlias ?? `${field.aggregation}_${field.column}`.replace(/[^\p{L}\p{N}_$]/gu, '_');
  const alias = assertIdentifier(rawAlias, '别名');
  const agg = AGG_SQL[field.aggregation];
  if (!agg) throw new PeanutError('VALIDATION_FAILED', `不支持的聚合方式: ${String(field.aggregation)}`);
  return agg(column, quote(alias, style));
}

/**
 * 筛选运算符的规范写法。历史配置里可能同时存在 SQL 风格（`=`、`is null`）
 * 与缩写风格（`eq`、`is_null`），这里统一收敛，避免同一条配置在两处解释不一致。
 */
const OPERATOR_ALIASES: Record<string, string> = {
  eq: '=',
  '=': '=',
  ne: '!=',
  '!=': '!=',
  '<>': '<>',
  gt: '>',
  '>': '>',
  gte: '>=',
  '>=': '>=',
  lt: '<',
  '<': '<',
  lte: '<=',
  '<=': '<=',
  in: 'in',
  like: 'like',
  is_null: 'is null',
  'is null': 'is null',
  not_null: 'is not null',
  'is not null': 'is not null',
};

/** 供接口层复用的运算符清单（保证前后端与生成器三处口径一致）。 */
export const CHART_FILTER_OPERATORS = [
  '=',
  '!=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'in',
  'like',
  'is null',
  'is not null',
] as const;

/**
 * 运算符归一：同时接受 SQL 风格与缩写风格，未知运算符返回 undefined。
 * 生成 SQL 与保存前校验共用这一个入口，避免"能保存但生成时才报错"的漂移。
 */
function resolveOperator(raw: unknown): string | undefined {
  return OPERATOR_ALIASES[String(raw).toLowerCase().trim()];
}

export interface ChartQueryOptions {
  limit?: number | null;
  /**
   * 数据来源表／视图名。**必填**：早期版本漏了 FROM 子句，
   * 生成的 SQL 根本跑不通（SELECT ... GROUP BY ... 无来源表）。
   */
  table?: string | null;
  /** 来源表所属 schema；为空表示不加限定 */
  schema?: string | null;
  /** 目标连接的标识符引号风格 */
  quoteStyle?: ChartQuoteStyle;
}

/**
 * 生成图表数据查询 SQL。
 * 约束：维度走 GROUP BY，指标走聚合函数，值一律经字面量转义；
 * 排序与 LIMIT 只接受结构化输入，不接受原始 SQL 片段。
 */
export function buildChartSql(config: ChartConfig, options: ChartQueryOptions = {}): string {
  const dimensions = config.dimensions ?? [];
  const metrics = config.metrics ?? [];
  if (dimensions.length === 0 && metrics.length === 0) {
    throw new PeanutError('VALIDATION_FAILED', '图表至少需要一个维度或指标');
  }

  const style: ChartQuoteStyle = options.quoteStyle ?? 'standard';
  const table = options.table?.trim();
  if (!table) {
    // 宁可直接报错，也不要生成一条没有 FROM、注定执行失败的 SQL
    throw new PeanutError('VALIDATION_FAILED', '生成图表 SQL 需要指定来源表（table）', {
      hint: '请在图表的 sourceRef 中填写表或视图名',
    });
  }
  const from = options.schema
    ? `${quote(options.schema, style)}.${quote(table, style)}`
    : quote(table, style);

  // 维度与指标统一走 fieldExpr：'none' 的别名也要生效（见 fieldExpr 注释）
  const selects = [
    ...dimensions.map((d) => fieldExpr(d, style)),
    ...metrics.map((m) => fieldExpr(m, style)),
  ];

  const lines = [`SELECT ${selects.join(', ')}`, `FROM ${from}`];
  if (config.filters && config.filters.length > 0) {
    const clauses = config.filters.map((f) => {
      const column = quote(f.column, style);
      const value = f.value;
      const op = resolveOperator(f.operator);
      switch (op) {
        case '=':
        case '!=':
        case '<>':
        case '>':
        case '>=':
        case '<':
        case '<=':
          return `${column} ${op} ${literal(value, style)}`;
        case 'in':
          if (!Array.isArray(value) || value.length === 0) {
            throw new PeanutError('VALIDATION_FAILED', `筛选 ${f.column} 使用 in 时值必须是非空数组`);
          }
          return `${column} IN (${value.map((item) => literal(item, style)).join(', ')})`;
        case 'like':
          return `${column} LIKE ${literal(value, style)}`;
        case 'is null':
          return `${column} IS NULL`;
        case 'is not null':
          return `${column} IS NOT NULL`;
        default:
          throw new PeanutError('VALIDATION_FAILED', `不支持的筛选运算符: ${String(f.operator)}`, {
            supported: CHART_FILTER_OPERATORS,
          });
      }
    });
    lines.push(`WHERE ${clauses.join(' AND ')}`);
  }

  if (dimensions.length > 0) {
    lines.push(`GROUP BY ${dimensions.map((d) => quote(d.column, style)).join(', ')}`);
  }

  if (config.sort && config.sort.length > 0) {
    const order = config.sort
      .map((s) => `${quote(s.column, style)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`)
      .join(', ');
    lines.push(`ORDER BY ${order}`);
  }

  const limit = config.limit ?? options.limit ?? null;
  if (limit !== null && limit !== undefined) {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100_000) {
      throw new PeanutError('VALIDATION_FAILED', `limit 非法: ${String(limit)}`);
    }
    lines.push(`LIMIT ${limit}`);
  }

  return `${lines.join('\n')};`;
}

/**
 * SQL 字面量转义：数字直出，其余按单引号字符串转义，NULL 特判。
 *
 * **必须按方言处理反斜杠**：MySQL 系（含 MariaDB/TiDB/OceanBase）默认把 `\`
 * 当字符串转义符，只把单引号翻倍是不够的 —— 筛选值 `\' UNION SELECT ...`
 * 会提前闭合字符串造成注入，哪怕值里只是普通的 `C:\path` 也会变成语法错误。
 * 因此 MySQL 分支先把反斜杠翻倍、再翻倍单引号（顺序不能反：先翻引号会把
 * 后插入的转义反斜杠一起翻倍）。标准方言（PostgreSQL/SQLite/Oracle/SQL Server）
 * 默认 standard_conforming_strings / 无 C 风格转义，反斜杠是普通字符，不能翻倍，
 * 否则会把用户数据写坏。
 */
function literal(value: unknown, style: ChartQuoteStyle = 'standard'): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const raw = String(value);
  const escaped =
    style === 'mysql'
      ? raw.replace(/\\/g, '\\\\').replace(/'/g, "''")
      : raw.replace(/'/g, "''");
  return `'${escaped}'`;
}

export interface ChartValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** 校验图表配置是否满足该图表类型的最低要求（PRD M06-04）。 */
export function validateChartConfig(type: ChartType, config: ChartConfig): ChartValidation {
  const info = getChartTypeInfo(type);
  const errors: string[] = [];
  const warnings: string[] = [];

  const dimensions = config.dimensions ?? [];
  const metrics = config.metrics ?? [];

  if (dimensions.length < info.minDimensions) {
    errors.push(`${info.label} 至少需要 ${info.minDimensions} 个维度，当前 ${dimensions.length} 个`);
  }
  if (metrics.length < info.minMetrics) {
    errors.push(`${info.label} 至少需要 ${info.minMetrics} 个指标，当前 ${metrics.length} 个`);
  }

  for (const dim of dimensions) {
    if (dim.aggregation !== 'none') {
      warnings.push(`维度 ${dim.column} 使用了聚合（${dim.aggregation}），通常维度不应聚合`);
    }
  }
  for (const metric of metrics) {
    if (metric.aggregation === 'none') {
      warnings.push(`指标 ${metric.column} 未设置聚合方式，将逐行返回，可能产生大量数据点`);
    }
  }

  for (const field of [...dimensions, ...metrics]) {
    // 聚合方式先于字段名检查：median 这类未实现的聚合必须在**创建/保存图表**时
    // 就报错，而不是等到取数时才失败，更不能像旧实现那样静默拿 AVG 顶替。
    if (!SUPPORTED_AGGREGATIONS.includes(field.aggregation)) {
      errors.push(
        `暂不支持聚合方式 ${field.aggregation}（中位数 median 尚未实现，请改用 avg / min / max 或自定义 SQL）`,
      );
    }
    try {
      assertIdentifier(field.column, '字段名');
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    // 别名会被拼进 SQL 的 AS 子句，必须和列名一样过白名单；
    // 否则配置能保存成功，取数时才报"别名非法"，用户分不清是配置还是数据问题。
    if (field.alias !== undefined) {
      try {
        assertIdentifier(field.alias, '别名');
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // 筛选列 / 运算符 / in 取值：以前只在 buildChartSql 里校验，保存接口一律放行，
  // 于是能存下"永远取不到数"的图表。这里提前到保存前的配置校验阶段。
  for (const filter of config.filters ?? []) {
    try {
      assertIdentifier(filter.column, '筛选列名');
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    const op = resolveOperator(filter.operator);
    if (op === undefined) {
      errors.push(
        `不支持的筛选运算符 ${JSON.stringify(filter.operator)}（支持：${CHART_FILTER_OPERATORS.join(' / ')}）`,
      );
      continue;
    }
    if (op === 'in' && (!Array.isArray(filter.value) || filter.value.length === 0)) {
      errors.push(`筛选 ${filter.column} 使用 in 时值必须是非空数组`);
    }
  }

  if (type === 'pie' || type === 'donut') {
    if (metrics.length > 1) warnings.push('饼图/环形图通常只展示一个指标，多余的指标会被忽略');
    if (dimensions.length > 1) warnings.push('饼图/环形图维度过多会导致扇区碎化，建议只保留 1 个维度');
  }
  if ((type === 'scatter' || type === 'bubble') && dimensions.length < 2) {
    warnings.push(`${info.label} 的两个维度将作为 X/Y 轴使用`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
