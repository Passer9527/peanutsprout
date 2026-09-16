/**
 * 花生苗数据库管理工具 - 内置 SQLite 驱动
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 使用 Node 24 内置的 node:sqlite，无任何原生编译依赖 —— 这是本项目
 * 「安装即用、零环境依赖」目标的关键：用户机器上不需要 node-gyp、
 * Python 构建链或预编译二进制。安装包默认自带一个本地 SQLite 连接，
 * 同时它也是驱动 SPI 的参考实现。
 */

import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  DEFAULT_CAPABILITIES,
  PeanutError,
  getDbTypeInfo,
  isReadStatement,
  isWriteStatement,
  splitSqlStatements,
  stripSqlComments,
  type CellValue,
  type ColumnInfo,
  type ConnectionConfig,
  type ConnectionTestResult,
  type DatabaseDriver,
  type DbTypeInfo,
  type DdlGenerator,
  type DriverCapabilities,
  type DriverConnection,
  type ExecutionPlan,
  type ExecutionPlanNode,
  type ExplainParser,
  type IndexInfo,
  type MetadataProvider,
  type QueryExecutor,
  type QueryOptions,
  type QueryResult,
  type SchemaInfo,
  type TableInfo,
  type TypeMapper,
} from '@peanutsprout/core';
import { quoteIdent, quoteQualified } from './identifiers.js';
import { BoundedCancelSet } from './cancel-set.js';
import { BaseTypeMapper } from './type-map.js';

/**
 * 把领域层的单元格值转成 node:sqlite 可绑定的类型。
 * undefined/boolean 需要归一化，bigint 保留精度。
 */
function toBindParams(params?: CellValue[]): Array<null | number | bigint | string | Uint8Array> {
  if (!params || params.length === 0) return [];
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/** Number 能精确表示的范围；超出后必须用字符串保真。 */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * 把 SQLite 返回值归一化成可 JSON 序列化的单元格。
 *
 * 大整数（> 2^53）以 BigInt 读出后转字符串：既不会像 Number 那样静默失真，
 * 也不会让上层的 JSON.stringify 因 BigInt 抛错（CellValue 本身不含 bigint，
 * 服务端的 serializeCell 也把 bigint 转字符串）。安全范围内的整数仍还原成
 * Number，保持既有行为不变。
 */
function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') {
    return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return value;
  return String(value);
}

/** 解析 SQLite 连接目标：databaseName 优先，其次 connectionUrl 的 file: 部分。 */
export function resolveSqlitePath(config: ConnectionConfig): string {
  const fromName = config.databaseName?.trim();
  if (fromName) return fromName;
  const url = config.connectionUrl?.trim();
  if (url) {
    if (url.startsWith('file:')) return url.slice('file:'.length) || ':memory:';
    if (!url.includes('://')) return url;
  }
  const extra = config.extraParams?.['path'];
  if (extra) return extra;
  throw new PeanutError('VALIDATION_FAILED', 'SQLite 连接需要指定数据库文件路径（databaseName）');
}

class SqliteMetadataProvider implements MetadataProvider {
  constructor(private readonly db: DatabaseSync) {}

  async listSchemas(): Promise<SchemaInfo[]> {
    const rows = this.db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
    return rows.map((r) => ({ name: r.name, comment: r.file || ':memory:' }));
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const s = quoteIdent(schema);
    const rows = this.db
      .prepare(
        `SELECT name, type FROM ${s}.sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as Array<{ name: string; type: string }>;
    return rows.map((r) => ({
      schema,
      name: r.name,
      kind: r.type === 'view' ? 'view' : 'table',
      comment: null,
    }));
  }

  async listViews(schema: string): Promise<TableInfo[]> {
    return (await this.listTables(schema)).filter((t) => t.kind === 'view');
  }

  async listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const rows = this.db
      .prepare(`PRAGMA ${quoteIdent(schema)}.table_info(${sqlLiteral(table)})`)
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    return rows.map((r) => ({
      schema,
      table,
      name: r.name,
      dataType: r.type || 'BLOB',
      nullable: r.notnull === 0,
      defaultValue: r.dflt_value,
      comment: null,
      isPrimaryKey: r.pk > 0,
      ordinal: r.cid,
    }));
  }

  async listIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const list = this.db
      .prepare(`PRAGMA ${quoteIdent(schema)}.index_list(${sqlLiteral(table)})`)
      .all() as Array<{ name: string; unique: number; origin: string }>;
    return list.map((idx) => {
      const cols = this.db
        .prepare(`PRAGMA ${quoteIdent(schema)}.index_info(${sqlLiteral(idx.name)})`)
        .all() as Array<{ name: string | null }>;
      return {
        schema,
        table,
        name: idx.name,
        columns: cols.map((c) => c.name ?? '').filter(Boolean),
        unique: idx.unique === 1,
        primary: idx.origin === 'pk',
      };
    });
  }

  async listConstraints(schema: string, table: string) {
    const fks = this.db
      .prepare(`PRAGMA ${quoteIdent(schema)}.foreign_key_list(${sqlLiteral(table)})`)
      .all() as Array<{ id: number; table: string; from: string; to: string | null }>;
    return fks.map((fk) => ({
      schema,
      table,
      name: `fk_${table}_${fk.id}`,
      type: 'foreign_key' as const,
      definition: `FOREIGN KEY (${fk.from}) REFERENCES ${fk.table}(${fk.to ?? '?'})`,
    }));
  }

  async listProcedures(): Promise<Array<{ name: string; kind: 'procedure' | 'function' }>> {
    // SQLite 无存储过程；用户自定义函数也无法从元数据枚举
    return [];
  }

  async listTriggers(schema: string): Promise<Array<{ name: string; table: string | null }>> {
    const rows = this.db
      .prepare(`SELECT name, tbl_name FROM ${quoteIdent(schema)}.sqlite_master WHERE type = 'trigger'`)
      .all() as Array<{ name: string; tbl_name: string }>;
    return rows.map((r) => ({ name: r.name, table: r.tbl_name }));
  }
}

/** PRAGMA 不接受绑定参数，这里只能内联；用单引号字面量 + 转义保证安全。 */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class SqliteQueryExecutor implements QueryExecutor {
  private readonly cancelled = new BoundedCancelSet();

  constructor(
    private readonly db: DatabaseSync,
    private readonly readOnly: boolean,
  ) {}

  async execute(sql: string, options: QueryOptions = {}): Promise<QueryResult> {
    const started = Date.now();
    const queryId = randomUUID();
    const cleaned = stripSqlComments(sql).trim();
    if (!cleaned) throw new PeanutError('VALIDATION_FAILED', 'SQL 语句为空');

    if (this.readOnly && isWriteStatement(cleaned)) {
      throw new PeanutError(
        'READONLY_VIOLATION',
        '该连接已开启只读保护，禁止执行写操作',
        { sql: cleaned.slice(0, 200) },
      );
    }

    // node:sqlite 的 `prepare()` 会**静默接受**多语句文本，而 `run()/iterate()`
    // 只执行第一条 —— 第二条起被无声丢弃，不抛任何错。实测：
    //   prepare('CREATE TABLE t (a);\nCREATE INDEX ix ON t (a);').run()
    //   → 表建好了，索引根本没建，changes 是 0，一切"成功"。
    // 对用户来说这是"我以为执行了一个脚本，其实只跑了第一句"，
    // 属于最坏的失败形态：静默给出错误结果。这里显式拒绝，
    // 与 MySQL 驱动（multipleStatements: false）和 PostgreSQL 的
    // 扩展协议行为保持一致：**一次一条，多了就报错**。
    const statementCount = splitSqlStatements(cleaned).length;
    if (statementCount > 1) {
      throw new PeanutError(
        'VALIDATION_FAILED',
        `SQLite 驱动一次只执行一条语句（本次提交了 ${statementCount} 条）。请拆开后逐条执行 —— ` +
          '否则第二条起会被底层静默丢弃，而界面仍显示成功。',
        { statements: statementCount },
      );
    }

    const maxRows = Math.max(1, options.maxRows ?? 10_000);
    const timeoutMs = options.timeoutMs ?? 0;

    try {
      let stmt: StatementSync;
      try {
        stmt = this.db.prepare(sql);
      } catch (e) {
        throw new PeanutError('QUERY_FAILED', e instanceof Error ? e.message : String(e));
      }
      // 让 node:sqlite 直接按列顺序返回数组，而不是按列名组装对象：
      // `SELECT a.id, b.id` 这种同名列在对象里只会剩一个，返回的就是错误数据。
      stmt.setReturnArrays(true);
      // 64 位 INTEGER 超过 Number 安全范围时，默认会直接抛错让整条查询失败；
      // 开启 readBigInts 后由 toCell 决定降级为字符串，既不抛错也不失真。
      stmt.setReadBigInts(true);

      let columnMeta: Array<{ name: string; dataType: string }>;
      try {
        const cols = stmt.columns();
        columnMeta = cols.map((c, i) => ({ name: c.name ?? `col_${i + 1}`, dataType: c.type ?? 'unknown' }));
      } catch {
        columnMeta = [];
      }

      // 无结果集的语句（INSERT/UPDATE/DELETE/DDL）走 run()
      if (columnMeta.length === 0) {
        if (this.readOnly && isWriteStatement(cleaned)) {
          throw new PeanutError('READONLY_VIOLATION', '该连接已开启只读保护，禁止执行写操作');
        }
        try {
          const r = stmt.run(...toBindParams(options.params));
          return {
            queryId,
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: Number(r.changes),
            durationMs: Date.now() - started,
            truncated: false,
            notices: [],
          };
        } catch (e) {
          throw new PeanutError('QUERY_FAILED', e instanceof Error ? e.message : String(e));
        }
      }

      const rows: CellValue[][] = [];
      let truncated = false;
      const notices: string[] = [];
      try {
        let scanned = 0;
        for (const raw of stmt.iterate(...toBindParams(options.params)) as IterableIterator<unknown[]>) {
          if (this.cancelled.has(queryId)) {
            throw new PeanutError('QUERY_CANCELLED', '查询已取消');
          }
          if (rows.length >= maxRows) {
            truncated = true;
            break;
          }
          if (timeoutMs > 0 && (++scanned % 500 === 0) && Date.now() - started > timeoutMs) {
            throw new PeanutError('QUERY_TIMEOUT', `查询超过 ${timeoutMs}ms 未完成，已中止`);
          }
          // raw 已是按列顺序的数组，同名列不会被覆盖
          rows.push(raw.map(toCell));
        }
      } catch (e) {
        if (e instanceof PeanutError) throw e;
        throw new PeanutError('QUERY_FAILED', e instanceof Error ? e.message : String(e));
      }

      if (truncated) {
        notices.push(`结果集超过 ${maxRows} 行，已截断；请缩小范围或分批导出`);
      }

      return {
        queryId,
        columns: columnMeta,
        rows,
        rowCount: rows.length,
        affectedRows: 0,
        durationMs: Date.now() - started,
        truncated,
        notices,
      };
    } finally {
      // 无论成功、失败还是被取消，都清掉本次 queryId 的取消标记，避免集合只增不减
      this.cancelled.delete(queryId);
    }
  }

  async executeUpdate(sql: string, params?: CellValue[]): Promise<number> {
    const result = await this.execute(sql, params ? { params } : {});
    return result.affectedRows;
  }

  async explain(sql: string): Promise<ExecutionPlan> {
    const cleaned = stripSqlComments(sql).trim();
    if (!cleaned) throw new PeanutError('VALIDATION_FAILED', 'SQL 语句为空');
    if (!isReadStatement(cleaned)) {
      throw new PeanutError('VALIDATION_FAILED', '执行计划仅支持 SELECT / WITH 等只读语句');
    }
    let rows: Array<{ id: number; parent: number; detail: string }>;
    try {
      rows = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as typeof rows;
    } catch (e) {
      throw new PeanutError('QUERY_FAILED', e instanceof Error ? e.message : String(e));
    }
    const content = rows.map((r) => `${'  '.repeat(r.parent === 0 ? 0 : 1)}${r.detail}`).join('\n');
    const nodes: ExecutionPlanNode[] = rows.map((r) => ({
      id: String(r.id),
      label: r.detail,
      detail: `node=${r.id} parent=${r.parent}`,
    }));
    return {
      format: 'text',
      content: content || '(执行计划为空)',
      raw: rows,
      // SQLite 的 EXPLAIN QUERY PLAN 不返回耗时，无法给出占比
      nodes,
    };
  }

  /**
   * 取消标记下发。
   *
   * node:sqlite 是**同步** API：`iterate()` 的整个循环不会让出事件循环，
   * 因此外部在查询进行中根本拿不到 queryId、也无法插入一次 cancel 调用，
   * 这个接口对 SQLite 实际无法中断正在执行的语句。
   * 这里保留接口语义（QueryExecutor 契约要求），但把集合做成有界集合：
   * 客户端反复传入任意字符串也不会造成内存无界增长。
   */
  cancel(queryId: string): void {
    this.cancelled.add(queryId);
  }

  /** 当前取消标记数量（测试用：证明集合不会无界增长） */
  get cancelMarkCount(): number {
    return this.cancelled.size;
  }
}

class SqliteExplainParser implements ExplainParser {
  parse(raw: unknown): ExecutionPlan {
    if (Array.isArray(raw)) {
      const rows = raw as Array<{ id: number; parent: number; detail: string }>;
      return {
        format: 'text',
        content: rows.map((r) => r.detail).join('\n'),
        raw,
        nodes: rows.map((r) => ({ id: String(r.id), label: r.detail })),
      };
    }
    return { format: 'text', content: String(raw ?? ''), raw };
  }

  toTree(plan: ExecutionPlan): ExecutionPlanNode[] {
    return plan.nodes ?? [{ id: 'root', label: plan.content.slice(0, 120) }];
  }
}

class SqliteDdlGenerator implements DdlGenerator {
  createTable(schema: string, table: string, columns: ColumnInfo[], indexes: IndexInfo[] = []): string {
    const cols = columns.map((c) => {
      const parts = [quoteIdent(c.name), c.dataType];
      if (!c.nullable) parts.push('NOT NULL');
      if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`);
      return `  ${parts.join(' ')}`;
    });
    const pk = columns.filter((c) => c.isPrimaryKey).map((c) => quoteIdent(c.name));
    if (pk.length > 0) cols.push(`  PRIMARY KEY (${pk.join(', ')})`);
    const lines = [`CREATE TABLE ${quoteQualified(schema, table)} (`, cols.join(',\n'), ');'];
    for (const idx of indexes) lines.push(this.createIndex(schema, table, idx));
    return lines.join('\n');
  }

  dropTable(schema: string, table: string): string {
    return `DROP TABLE ${quoteQualified(schema, table)};`;
  }

  addColumn(schema: string, table: string, column: ColumnInfo): string {
    const parts = [quoteIdent(column.name), column.dataType];
    if (!column.nullable) parts.push('NOT NULL');
    if (column.defaultValue) parts.push(`DEFAULT ${column.defaultValue}`);
    return `ALTER TABLE ${quoteQualified(schema, table)} ADD COLUMN ${parts.join(' ')};`;
  }

  alterColumn(): string {
    // SQLite 在 3.35 之前不支持 ALTER COLUMN，标准做法是重建表
    return '-- SQLite 不支持直接修改列定义，请使用「重建表」流程（新建 → 复制数据 → 改名）';
  }

  dropColumn(schema: string, table: string, column: string): string {
    return `ALTER TABLE ${quoteQualified(schema, table)} DROP COLUMN ${quoteIdent(column)};`;
  }

  createIndex(schema: string, table: string, index: IndexInfo): string {
    const unique = index.unique ? 'UNIQUE ' : '';
    // SQLite 的语法是 `CREATE INDEX [schema.]index_name ON table_name (...)` ——
    // **schema 只能限定索引名，ON 后面的表名不能带 schema**。
    // 旧实现写成 `ON "main"."t"`，SQLite 直接报 `near ".": syntax error`，
    // 也就是"只要 schema 不为空，建索引就一定失败"。因为之前没有表设计器，
    // 这条路径从没被真正跑过，所以一直没暴露。
    const indexName = schema ? `${quoteIdent(schema)}.${quoteIdent(index.name)}` : quoteIdent(index.name);
    return `CREATE ${unique}INDEX ${indexName} ON ${quoteIdent(table)} (${index.columns
      .map(quoteIdent)
      .join(', ')});`;
  }

  dropIndex(schema: string, _table: string, indexName: string): string {
    // 与 createIndex 同理：schema 限定索引名（`DROP INDEX "main"."ix"`）
    const qualified = schema ? `${quoteIdent(schema)}.${quoteIdent(indexName)}` : quoteIdent(indexName);
    return `DROP INDEX ${qualified};`;
  }
}

class SqliteConnection implements DriverConnection {
  readonly id: string;
  private readonly metadata: SqliteMetadataProvider;
  private readonly executor: SqliteQueryExecutor;
  private readonly ddl = new SqliteDdlGenerator();
  private readonly types: TypeMapper = new BaseTypeMapper('sqlite');
  private readonly explainParser = new SqliteExplainParser();
  private closed = false;

  constructor(
    readonly config: ConnectionConfig,
    private readonly db: DatabaseSync,
    readonly filePath: string,
  ) {
    this.id = `sqlite:${config.id}:${randomUUID().slice(0, 8)}`;
    this.metadata = new SqliteMetadataProvider(db);
    this.executor = new SqliteQueryExecutor(db, config.readOnly);
  }

  async ping(): Promise<{ latencyMs: number; serverVersion: string | null }> {
    const started = Date.now();
    const row = this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string } | undefined;
    return { latencyMs: Date.now() - started, serverVersion: row?.v ?? null };
  }

  getMetadata(): MetadataProvider {
    return this.metadata;
  }

  getQueryExecutor(): QueryExecutor {
    return this.executor;
  }

  getDdlGenerator(): DdlGenerator {
    return this.ddl;
  }

  getTypeMapper(): TypeMapper {
    return this.types;
  }

  getExplainParser(): ExplainParser {
    return this.explainParser;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export class SqliteDriver implements DatabaseDriver {
  readonly dbType = 'sqlite' as const;
  readonly name = '花生苗内置 SQLite 驱动';
  readonly version = '1.0.0';
  readonly implemented = true;
  readonly capabilities: DriverCapabilities = {
    ...DEFAULT_CAPABILITIES,
    schemas: true,
    transactions: true,
    explain: true,
    streaming: true,
    serverSidePagination: false,
    cdc: false,
    ddl: true,
  };

  getInfo(): DbTypeInfo {
    return getDbTypeInfo('sqlite');
  }

  async connect(config: ConnectionConfig): Promise<DriverConnection> {
    const filePath = resolveSqlitePath(config);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(filePath, { readOnly: config.readOnly });
    } catch (e) {
      throw new PeanutError(
        'CONNECTION_FAILED',
        `打开 SQLite 数据库失败: ${e instanceof Error ? e.message : String(e)}`,
        { filePath },
      );
    }
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    if (!config.readOnly) {
      try {
        db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        /* 只读文件系统等场景忽略 */
      }
    }
    return new SqliteConnection(config, db, filePath);
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const started = Date.now();
    let conn: DriverConnection | null = null;
    try {
      conn = await this.connect(config);
      const { serverVersion } = await conn.ping();
      return {
        ok: true,
        latencyMs: Date.now() - started,
        serverVersion: serverVersion ? `SQLite ${serverVersion}` : null,
        message: '连接成功',
      };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        serverVersion: null,
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      if (conn) await conn.close().catch(() => undefined);
    }
  }
}
