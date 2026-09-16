/**
 * 花生苗数据库管理工具 - 网络型关系数据库驱动公共基类
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * PostgreSQL 与 MySQL 协议族的驱动在"执行 / DDL 生成 / 类型归一 / 执行计划"
 * 这些环节逻辑几乎一致，差异集中在方言（引号、分页语法、元数据查询）。
 * 这里把公共部分收口，方言差异由子类通过 `RelationalDialect` 注入，
 * 避免把同一段执行逻辑复制两遍后各自漂移。
 */

import {
  PeanutError,
  isWriteStatement,
  normalizeError,
  stripSqlComments,
  type CellValue,
  type ColumnInfo,
  type DatabaseType,
  type DdlGenerator,
  type ExecutionPlan,
  type ExecutionPlanNode,
  type ExplainParser,
  type IndexInfo,
  type QueryExecutor,
  type QueryOptions,
  type QueryResult,
  type TypeMapper,
} from '@peanutsprout/core';
import { BoundedCancelSet } from './cancel-set.js';
import { BaseTypeMapper } from './type-map.js';

/** 一次底层查询的执行结果（已由子类归一化）。 */
export interface RawQueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: CellValue[][];
  affectedRows: number;
  /** 子类可给出服务端耗时；无法获取时为 null */
  durationMs?: number | null;
}

/** 传给子类 `run` 的执行上下文（目前只有超时，后续可扩展取消信号）。 */
export interface RunQueryContext {
  /** 超时毫秒；0/undefined 表示不限 */
  timeoutMs?: number;
}

export interface RelationalDialect {
  /** 标识符引号风格 */
  quote(name: string): string;
  /** 生成"限定名" */
  qualified(schema: string | null | undefined, name: string): string;
  /** 只读语句加限制时的语法；返回 null 表示由子类自行处理分页 */
  limitClause(maxRows: number): string;
  /** 渲染列类型（考虑长度/精度） */
  renderType(column: ColumnInfo): string;
  /** 生成执行计划语句（各库语法不同：PG 要 FORMAT JSON，MySQL 直接 EXPLAIN） */
  explainStatement(sql: string): string;
}

/** 执行计划支持：由子类提供"取原始计划"的函数与解析器。 */
export interface ExplainSupport {
  parser: ExplainParser;
  /** 返回**未经归一化**的原始计划载荷（JSON 结构不能被 toCell 字符串化） */
  run: (sql: string) => Promise<unknown>;
}

/** 把驱动返回值归一化成可 JSON 序列化的单元格。 */
export function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  // 数值类型驱动可能返回字符串（如 NUMERIC/DECIMAL），保留原样交由上层展示
  // 带时区语义的 Date（如 PG 的 timestamptz）转成绝对时刻；无时区语义的
  // date/timestamp 已在驱动层改成原样字符串，不会走到这里被时区平移。
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return new Uint8Array(value as Uint8Array);
  }
  if (typeof value === 'object') {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
    // PG 的 NUMERIC 会以字符串返回；MySQL 的 JSON 列可能返回对象
    if (ctor === 'String' || ctor === 'Number') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** 统计列的 dataType；驱动未给出时回退到 unknown。 */
export function columnMetaOf(
  columns: Array<{ name?: string; dataType?: string | null } | string> | undefined,
): Array<{ name: string; dataType: string }> {
  if (!columns) return [];
  return columns.map((c) =>
    typeof c === 'string'
      ? { name: c, dataType: 'unknown' }
      : { name: c.name ?? '?', dataType: c.dataType ?? 'unknown' },
  );
}

/**
 * 从 URL 里取主机名。
 *
 * `new URL('postgres://u:p@[::1]:5432/db').hostname` 会保留 IPv6 的方括号，
 * 直接交给 net.connect 会 ENOTFOUND。这里统一去掉方括号。
 */
export function hostnameOf(parsed: URL): string {
  return decodeURIComponent(parsed.hostname).replace(/^\[|\]$/g, '');
}

/**
 * 判断 SQL 里是否**已经有**顶层的行数限制（LIMIT / FETCH FIRST）。
 *
 * 不能直接用正则扫原文：
 *  ① `WHERE msg = 'no limit'` 里的字符串会误命中；
 *  ② 子查询/CTE 里的 LIMIT 不是整条语句的顶层限制，外层仍需补 LIMIT。
 * 因此先去掉注释，再逐字符扫描：跳过字符串字面量、只在括号深度为 0 时认关键字。
 */
export function hasTopLevelLimit(sql: string): boolean {
  const cleaned = stripSqlComments(sql);
  let depth = 0;
  let i = 0;
  const n = cleaned.length;
  while (i < n) {
    const ch = cleaned[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (cleaned[i] === quote) {
          if (cleaned[i + 1] === quote) {
            i += 2; // 连续两个引号是转义
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(cleaned[j]!)) j++;
      const word = cleaned.slice(i, j).toLowerCase();
      // FETCH FIRST/NEXT 也是行数限制，再补 LIMIT 会变成语法错误
      if (word === 'limit' || word === 'fetch') return true;
      i = j;
      continue;
    }
    i++;
  }
  return false;
}

/**
 * 给查询套一层超时。
 *
 * 超时后必须由调用方通过 `onTimeout` **丢弃当前连接**（destroy / release(true)）：
 * 只把 Promise 判失败而把仍在跑查询的连接还回池里，下个请求就会复用到
 * 处于脏状态的连接。抛出的 QUERY_TIMEOUT 会原样透传给上层。
 */
export function withQueryTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  if (!(timeoutMs > 0)) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout();
      } catch {
        /* 丢弃连接失败不应掩盖超时本身 */
      }
      reject(new PeanutError('QUERY_TIMEOUT', `查询超过 ${timeoutMs}ms 未完成，已中止并丢弃该连接`));
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 通用查询执行器。
 * 子类只需提供 `runQuery(sql, params, ctx)`，其余（结果归一化、写操作计数、
 * 只读语句限行、取消标记）都在这里统一处理。
 */
export class RelationalQueryExecutor implements QueryExecutor {
  private readonly cancelled = new BoundedCancelSet();
  private seq = 0;

  constructor(
    private readonly dialect: RelationalDialect,
    private readonly run: (sql: string, params?: CellValue[], ctx?: RunQueryContext) => Promise<RawQueryResult>,
    private readonly onCancel?: (queryId: string) => void,
    private readonly explainSupport?: ExplainSupport,
    /** 只读连接：应用层先拦一道，数据库层只读事务再兜底（见各驱动 runQuery） */
    private readonly readOnly = false,
  ) {}

  async execute(sql: string, options?: QueryOptions): Promise<QueryResult> {
    const queryId = `q-${++this.seq}-${Date.now().toString(36)}`;
    const started = Date.now();
    const trimmed = sql.trim();
    if (!trimmed) throw new PeanutError('VALIDATION_FAILED', 'SQL 不能为空');

    const isWrite = isWriteStatement(trimmed);
    if (this.readOnly && isWrite) {
      throw new PeanutError('READONLY_VIOLATION', '该连接已开启只读保护，禁止执行写操作', {
        sql: trimmed.slice(0, 200),
      });
    }
    const maxRows = options?.maxRows ?? 0;
    // 只对只读语句追加限行；写语句加 LIMIT 会改变语义。
    //
    // 这里刻意**多取一行**（maxRows + 1）：拿回 maxRows+1 行就说明还有更多，
    // 既能精确判断 truncated，也能在结果里硬截断到 maxRows。
    // 拼接前先把注释去掉并把行尾分号吃掉，否则 `SELECT ... -- 注释` 会让
    // 追加的 LIMIT 被注释吞掉（曾经的限行绕过缺陷）。
    const shouldLimit = !isWrite && maxRows > 0 && !hasTopLevelLimit(trimmed);
    const finalSql = shouldLimit
      ? `${stripSqlComments(trimmed).trim().replace(/;+\s*$/, '')}\n${this.dialect.limitClause(maxRows + 1)}`
      : trimmed;

    try {
      const raw = await this.run(finalSql, options?.params, { timeoutMs: options?.timeoutMs });
      if (this.cancelled.has(queryId)) {
        throw new PeanutError('QUERY_CANCELLED', '查询已取消');
      }
      // 已经带 LIMIT 的 SQL 由用户自己限行，这里只按 maxRows 硬截断，不再补 LIMIT
      const truncated = !isWrite && maxRows > 0 && raw.rows.length > maxRows;
      const rows = !isWrite && maxRows > 0 && raw.rows.length > maxRows ? raw.rows.slice(0, maxRows) : raw.rows;
      return {
        queryId,
        columns: raw.columns,
        rows,
        rowCount: rows.length,
        affectedRows: isWrite ? raw.affectedRows : 0,
        durationMs: raw.durationMs ?? Date.now() - started,
        truncated,
        notices: [],
      };
    } catch (e) {
      throw normalizeError(e);
    } finally {
      this.cancelled.delete(queryId);
    }
  }

  async executeUpdate(sql: string, params?: CellValue[]): Promise<number> {
    const raw = await this.run(sql, params);
    return raw.affectedRows;
  }

  async explain(sql: string): Promise<ExecutionPlan> {
    const trimmed = sql.trim();
    if (!trimmed) throw new PeanutError('VALIDATION_FAILED', 'SQL 不能为空');
    if (!this.explainSupport) {
      throw new PeanutError('DRIVER_NOT_IMPLEMENTED', '该驱动尚未实现执行计划解析');
    }
    if (isWriteStatement(trimmed)) {
      // EXPLAIN 写语句在部分库上会真的改数据（如 MySQL 的 EXPLAIN ANALYZE），这里只允许只读
      throw new PeanutError('VALIDATION_FAILED', '仅支持对只读语句做执行计划分析');
    }
    try {
      const raw = await this.explainSupport.run(trimmed);
      return this.explainSupport.parser.parse(raw);
    } catch (e) {
      throw normalizeError(e);
    }
  }

  cancel(queryId: string): void {
    this.cancelled.add(queryId);
    this.onCancel?.(queryId);
  }
}

/**
 * 通用 DDL 生成器。
 * 各库的分页、引号差异走 dialect，列定义拼装逻辑一致。
 */
export class RelationalDdlGenerator implements DdlGenerator {
  constructor(protected readonly dialect: RelationalDialect) {}

  private columnDef(column: ColumnInfo): string {
    const parts = [this.dialect.quote(column.name), this.dialect.renderType(column)];
    if (column.nullable === false) parts.push('NOT NULL');
    if (column.defaultValue !== null && column.defaultValue !== undefined && column.defaultValue !== '') {
      parts.push(`DEFAULT ${column.defaultValue}`);
    }
    return parts.join(' ');
  }

  createTable(schema: string, table: string, columns: ColumnInfo[], indexes?: IndexInfo[]): string {
    if (columns.length === 0) throw new PeanutError('VALIDATION_FAILED', '建表至少需要一个字段');
    const lines = columns.map((c) => `  ${this.columnDef(c)}`);
    const pk = columns.filter((c) => c.isPrimaryKey);
    if (pk.length > 0) {
      lines.push(`  PRIMARY KEY (${pk.map((c) => this.dialect.quote(c.name)).join(', ')})`);
    }
    const target = this.dialect.qualified(schema, table);
    const statements = [`CREATE TABLE ${target} (\n${lines.join(',\n')}\n);`];
    for (const index of indexes ?? []) {
      statements.push(this.createIndex(schema, table, index));
    }
    return statements.join('\n\n');
  }

  dropTable(schema: string, table: string): string {
    return `DROP TABLE ${this.dialect.qualified(schema, table)};`;
  }

  addColumn(schema: string, table: string, column: ColumnInfo): string {
    return `ALTER TABLE ${this.dialect.qualified(schema, table)} ADD COLUMN ${this.columnDef(column)};`;
  }

  /**
   * 改列。PostgreSQL 与 MySQL 的 ALTER 语法差异较大（MySQL 用 MODIFY/CHANGE，
   * PG 用 TYPE），因此交由子类通过 dialect 覆写；默认给出 PG 风格。
   */
  alterColumn(schema: string, table: string, from: ColumnInfo, to: ColumnInfo): string {
    const target = this.dialect.qualified(schema, table);
    const quoted = this.dialect.quote(to.name);
    const statements: string[] = [];
    if (from.dataType !== to.dataType) {
      statements.push(`ALTER TABLE ${target} ALTER COLUMN ${quoted} TYPE ${this.dialect.renderType(to)};`);
    }
    if (from.nullable !== to.nullable) {
      statements.push(
        `ALTER TABLE ${target} ALTER COLUMN ${quoted} ${to.nullable === false ? 'SET' : 'DROP'} NOT NULL;`,
      );
    }
    if (from.defaultValue !== to.defaultValue) {
      statements.push(
        to.defaultValue === null || to.defaultValue === undefined || to.defaultValue === ''
          ? `ALTER TABLE ${target} ALTER COLUMN ${quoted} DROP DEFAULT;`
          : `ALTER TABLE ${target} ALTER COLUMN ${quoted} SET DEFAULT ${to.defaultValue};`,
      );
    }
    if (from.name !== to.name) {
      statements.push(`ALTER TABLE ${target} RENAME COLUMN ${this.dialect.quote(from.name)} TO ${quoted};`);
    }
    return statements.length > 0 ? statements.join('\n') : `-- 未检测到需要变更的属性`;
  }

  dropColumn(schema: string, table: string, column: string): string {
    return `ALTER TABLE ${this.dialect.qualified(schema, table)} DROP COLUMN ${this.dialect.quote(column)};`;
  }

  createIndex(schema: string, table: string, index: IndexInfo): string {
    const unique = index.unique ? 'UNIQUE ' : '';
    const cols = index.columns.map((c) => this.dialect.quote(c)).join(', ');
    return `CREATE ${unique}INDEX ${this.dialect.quote(index.name)} ON ${this.dialect.qualified(schema, table)} (${cols});`;
  }

  dropIndex(_schema: string, table: string, indexName: string): string {
    return `DROP INDEX ${this.dialect.quote(indexName)} ON ${this.dialect.qualified(null, table)};`;
  }
}

/** 通用类型映射器：绑定源库类型后即可做跨方言映射。 */
export function createTypeMapper(sourceDbType: DatabaseType): TypeMapper {
  return new BaseTypeMapper(sourceDbType);
}

/** 把扁平的执行计划行（EXPLAIN 输出）转成可画图的树。 */
export function planRowsToTree(
  rows: Array<Record<string, unknown>>,
  labelKeys: string[],
  costKeys: string[] = [],
): ExecutionPlanNode[] {
  return rows.map((row, i) => {
    const label =
      labelKeys.map((k) => row[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== '') ??
      `step ${i + 1}`;
    const cost: Record<string, unknown> = {};
    for (const k of costKeys) if (row[k] !== undefined) cost[k] = row[k];
    return {
      id: `node-${i + 1}`,
      label: String(label).slice(0, 300),
      detail: Object.keys(cost).length > 0 ? JSON.stringify(cost) : undefined,
      children: [],
    };
  });
}

/** 基础执行计划解析器：把原始 EXPLAIN 文本/行包成 ExecutionPlan。 */
export class TextExplainParser implements ExplainParser {
  constructor(
    private readonly toContent: (raw: unknown) => string,
    private readonly toRows?: (raw: unknown) => Array<Record<string, unknown>>,
    private readonly labelKeys: string[] = [],
  ) {}

  parse(raw: unknown): ExecutionPlan {
    const rows = this.toRows?.(raw) ?? [];
    const content = this.toContent(raw);
    const plan: ExecutionPlan = { format: rows.length > 0 ? 'json' : 'text', content, raw, nodes: [] };
    if (rows.length > 0 && this.labelKeys.length > 0) {
      plan.nodes = planRowsToTree(rows, this.labelKeys);
    }
    return plan;
  }

  toTree(plan: ExecutionPlan): ExecutionPlanNode[] {
    if (plan.nodes && plan.nodes.length > 0) return plan.nodes;
    // 没有结构化节点时，按行拆成扁平节点，保证界面仍能画出东西
    return plan.content
      .split('\n')
      .filter((l) => l.trim())
      .map((line, i) => ({ id: `line-${i}`, label: line.trim().slice(0, 300), detail: undefined, children: [] }));
  }
}

/**
 * 网络驱动的连接池参数归一化。
 * 无论是连接串还是分项配置，最终都要落到这几个参数上。
 */
export interface NetworkTarget {
  host: string;
  port: number;
  database: string | null;
  user: string | null;
  password: string | null;
  ssl: boolean | Record<string, unknown> | undefined;
}

/**
 * 从 extraParams 里取布尔开关。
 * 连接串里的参数是字符串（"true"/"1"），表单里是布尔，两种都要认。
 */
export function flagOf(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value.trim());
  return false;
}

/** 校验网络数据库连接必需的主机信息，缺失时给出可操作的报错。 */
export function requireHost(target: { host?: string | null; port?: number | null }, dbLabel: string): { host: string; port: number } {
  const host = target.host?.trim();
  if (!host) {
    throw new PeanutError('VALIDATION_FAILED', `${dbLabel} 连接需要指定主机地址（host）`);
  }
  const port = Number(target.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new PeanutError('VALIDATION_FAILED', `${dbLabel} 连接端口非法: ${String(target.port)}`);
  }
  return { host, port };
}

export { isWriteStatement };
