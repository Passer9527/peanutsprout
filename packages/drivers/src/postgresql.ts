/**
 * 花生苗数据库管理工具 - PostgreSQL 驱动
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 基于纯 JS 的 `pg` 驱动，无原生编译依赖。同一实现同时服务 PostgreSQL 与
 * 金仓 KingbaseES（PG 协议兼容），差异通过 extraParams 与方言开关处理。
 *
 * 元数据全部走 information_schema / pg_catalog，不依赖任何扩展，
 * 因此在 PGlite、RDS、自建 PG、KingbaseES 上都能工作。
 */

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CAPABILITIES,
  PeanutError,
  getDbTypeInfo,
  normalizeError,
  type CellValue,
  type ColumnInfo,
  type ConnectionConfig,
  type ConnectionTestResult,
  type ConstraintInfo,
  type DatabaseDriver,
  type DatabaseType,
  type DbTypeInfo,
  type DriverCapabilities,
  type DriverConnection,
  type ExecutionPlan,
  type ExecutionPlanNode,
  type ExplainParser,
  type IndexInfo,
  type MetadataProvider,
  type QueryExecutor,
  type SchemaInfo,
  type TableInfo,
  type TypeMapper,
  redactConnectionUrl,
} from '@peanutsprout/core';
import { quoteIdent, quoteQualified } from './identifiers.js';
import {
  RelationalDdlGenerator,
  RelationalQueryExecutor,
  TextExplainParser,
  createTypeMapper,
  flagOf,
  hostnameOf,
  requireHost,
  toCell,
  withQueryTimeout,
  type NetworkTarget,
  type RawQueryResult,
  type RelationalDialect,
  type RunQueryContext,
} from './relational.js';

/**
 * PG 协议族能识别的连接串协议头。
 * 金仓走 PG 线协议，因此 postgres:// 在 kingbase 连接上也应被接受；
 * 反过来 kingbase8:// 也必须被识别，否则连接串会被静默忽略、host 掉回 localhost。
 */
const PG_SCHEMES = ['postgres', 'postgresql', 'kingbase', 'kingbase8'] as const;

/**
 * 解析连接目标。**先解析连接串，再回填默认值** ——
 * 否则连接串里显式写的端口会被默认端口覆盖。
 */
export function resolvePostgresTarget(config: ConnectionConfig): NetworkTarget {
  const url = config.connectionUrl?.trim();
  let host = config.host?.trim() ?? '';
  let port = Number(config.port ?? 0);
  let database = config.databaseName?.trim() ?? '';
  let user = config.username?.trim() ?? '';
  let password = config.password ?? '';

  if (url) {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url)?.[1]?.toLowerCase();
    const declared = getDbTypeInfo(config.dbType).urlScheme.toLowerCase();
    const accepted = new Set<string>([...PG_SCHEMES, declared]);
    if (!scheme || !accepted.has(scheme)) {
      // 绝不静默回落：连接串被忽略会让用户以为连的是远端库，实际连到 localhost
      throw new PeanutError(
        'VALIDATION_FAILED',
        scheme
          ? `连接串协议 "${scheme}://" 与数据库类型 ${config.dbType} 不匹配（支持: ${[...accepted].join(', ')}）`
          : `无法识别 PostgreSQL 连接串的协议头: ${redactConnectionUrl(url) ?? '[已隐藏]'}`,
        { scheme: scheme ?? null, dbType: config.dbType, supported: [...accepted] },
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PeanutError('VALIDATION_FAILED', `无法解析 PostgreSQL 连接串: ${redactConnectionUrl(url) ?? '[已隐藏]'}`);
    }
    if (!host) host = hostnameOf(parsed);
    if (!port && parsed.port) port = Number(parsed.port);
    if (!database) database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!user) user = decodeURIComponent(parsed.username);
    if (!password) password = decodeURIComponent(parsed.password);
  }

  const { host: h, port: p } = requireHost({ host: host || 'localhost', port: port || 5432 }, 'PostgreSQL');
  const sslMode = config.extraParams?.['sslmode'] ?? config.extraParams?.['ssl'];
  const ssl =
    config.ssl?.enabled || flagOf(sslMode) || (typeof sslMode === 'string' && sslMode !== 'disable')
      ? { rejectUnauthorized: config.ssl?.rejectUnauthorized !== false }
      : undefined;

  return {
    host: h,
    port: p,
    database: database || user || 'postgres',
    user: user || 'postgres',
    password,
    ssl,
  };
}

const PG_DIALECT: RelationalDialect = {
  quote: quoteIdent,
  qualified: (schema, name) => quoteQualified(schema, name),
  limitClause: (maxRows) => `LIMIT ${maxRows}`,
  renderType: (column) => column.dataType,
  explainStatement: (sql) => `EXPLAIN (FORMAT JSON) ${sql}`,
};

// MySQL 的 ALTER 语义与 PG 不同，这里单独覆写 MySQL 不适用；PG 沿用基类默认实现
class PostgresDdlGenerator extends RelationalDdlGenerator {}

/** pg 驱动的最小接口，避免把 pg 的类型定义泄漏到公共层。 */
export interface PgClientLike {
  query(config: { text: string; values?: unknown[]; rowMode?: string }): Promise<{
    fields?: Array<{ name: string; dataTypeID?: number }>;
    rows: unknown[];
    rowCount: number | null;
  }>;
  end(): Promise<void>;
  /** pg 连接池归还句柄；release(true) 表示丢弃这条连接 */
  release?(err?: Error | boolean): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  query(config: {
    text: string;
    values?: unknown[];
    rowMode?: string;
  }): Promise<{
    fields?: Array<{ name: string; dataTypeID?: number }>;
    rows: unknown[] | Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end(): Promise<void>;
}

class PgMetadataProvider implements MetadataProvider {
  constructor(private readonly pool: PgPoolLike) {}

  private async rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const res = await this.pool.query({ text: sql, values: params });
    return res.rows as Array<Record<string, unknown>>;
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const rows = await this.rows(
      `SELECT n.nspname AS name,
              pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment
         FROM pg_catalog.pg_namespace n
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
           OR n.nspname = 'public'
        ORDER BY n.nspname`,
    );
    return rows.map((r) => ({ name: String(r['name']), comment: (r['comment'] as string) ?? null }));
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const rows = await this.rows(
      `SELECT c.relname AS name,
              CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                             WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized_view'
                             WHEN 'f' THEN 'foreign_table' ELSE 'table' END AS kind,
              pg_catalog.obj_description(c.oid, 'pg_class') AS comment,
              c.reltuples::bigint AS row_estimate
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','f')
        ORDER BY c.relname`,
      [schema],
    );
    return rows.map((r) => ({
      schema,
      name: String(r['name']),
      kind: String(r['kind']) as TableInfo['kind'],
      comment: (r['comment'] as string) ?? null,
      rowCount: Number(r['row_estimate'] ?? 0) || null,
    }));
  }

  async listViews(schema: string): Promise<TableInfo[]> {
    return (await this.listTables(schema)).filter((t) => t.kind === 'view');
  }

  async listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const rows = await this.rows(
      `SELECT a.attname AS name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
              NOT a.attnotnull AS nullable,
              pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
              a.attnum AS ordinal,
              COALESCE(pk.is_pk, false) AS is_pk,
              col_description(a.attrelid, a.attnum) AS comment,
              COALESCE(a.attidentity <> '' OR a.attgenerated <> '', false) AS auto_increment
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN (
           SELECT con.conrelid, unnest(con.conkey) AS attnum, true AS is_pk
             FROM pg_catalog.pg_constraint con
            WHERE con.contype = 'p'
         ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [schema, table],
    );
    return rows.map((r) => ({
      schema,
      table,
      name: String(r['name']),
      dataType: String(r['data_type']),
      nullable: Boolean(r['nullable']),
      defaultValue: (r['default_value'] as string) ?? null,
      isPrimaryKey: Boolean(r['is_pk']),
      comment: (r['comment'] as string) ?? null,
      ordinal: Number(r['ordinal'] ?? 0),
    }));
  }

  async listIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const rows = await this.rows(
      // 注意 k + 1：indkey 是 int2vector，其 generate_subscripts 从 0 开始计数，
      // 而 pg_get_indexdef 的列号从 1 开始；少加 1 会返回整条建索引语句。
      //
      // has_expression：pg_index.indexprs 非空表示索引里含表达式列（如 lower(email)）。
      // 这类"列"不是真实列名，若当成列名加引号会拼出非法 DDL，整表迁移直接中止。
      `SELECT i.relname AS name,
              ix.indisunique AS is_unique,
              ix.indisprimary AS is_primary,
              (ix.indexprs IS NOT NULL) AS has_expression,
              array_to_string(
                ARRAY(SELECT pg_catalog.pg_get_indexdef(ix.indexrelid, k + 1, true)
                        FROM generate_subscripts(ix.indkey, 1) AS k ORDER BY k), ',') AS columns,
              am.amname AS method
         FROM pg_catalog.pg_index ix
         JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
         JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_catalog.pg_am am ON am.oid = i.relam
        WHERE n.nspname = $1 AND t.relname = $2
        ORDER BY i.relname`,
      [schema, table],
    );
    return rows
      // IndexInfo 只能表达"真实列名列表"，无法表达表达式索引；与其返回
      // 一个会被错误加引号的伪列名，不如显式跳过（迁移时不重建该索引）。
      .filter((r) => !r['has_expression'])
      .map((r) => ({
        schema,
        table,
        name: String(r['name']),
        unique: Boolean(r['is_unique']),
        primary: Boolean(r['is_primary']),
        columns: String(r['columns'] ?? '')
          .split(',')
          .map((c) => c.trim().replace(/^"|"$/g, ''))
          .filter(Boolean),
      }));
  }

  async listConstraints(schema: string, table: string): Promise<ConstraintInfo[]> {
    const rows = await this.rows(
      `SELECT con.conname AS name,
              CASE con.contype WHEN 'p' THEN 'primary_key' WHEN 'f' THEN 'foreign_key'
                               WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check'
                               WHEN 'x' THEN 'exclude' ELSE 'other' END AS kind,
              pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
              rc.relname AS ref_table
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY con.conname`,
      [schema, table],
    );
    return rows.map((r) => ({
      schema,
      table,
      name: String(r['name']),
      type: String(r['kind']) as ConstraintInfo['type'],
      definition: String(r['definition'] ?? ''),
    }));
  }

  async listProcedures(schema: string): Promise<Array<{ name: string; kind: 'procedure' | 'function' }>> {
    const rows = await this.rows(
      `SELECT p.proname AS name, p.prokind AS kind
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
        ORDER BY p.proname`,
      [schema],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      kind: String(r['kind']) === 'p' ? ('procedure' as const) : ('function' as const),
    }));
  }

  async listTriggers(schema: string): Promise<Array<{ name: string; table: string | null }>> {
    const rows = await this.rows(
      `SELECT t.tgname AS name, c.relname AS table_name
         FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND NOT t.tgisinternal
        ORDER BY t.tgname`,
      [schema],
    );
    return rows.map((r) => ({ name: String(r['name']), table: (r['table_name'] as string) ?? null }));
  }
}

/** PG 的 EXPLAIN 支持 FORMAT JSON，解析成结构化节点用于可视化。 */
class PostgresExplainParser implements ExplainParser {
  private readonly fallback = new TextExplainParser(
    (raw) => (typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)),
    (raw) => (Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []),
    ['Node Type', 'Plan'],
  );

  parse(raw: unknown): ExecutionPlan {
    // 期望形态：[{ "Plan": { "Node Type": "...", "Plans": [...] } }]
    const planRoot = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)[0]?.['Plan']
      : (raw as Record<string, unknown> | null)?.['Plan'];
    if (!planRoot || typeof planRoot !== 'object') return this.fallback.parse(raw);
    const totalCost = Number((planRoot as Record<string, unknown>)['Total Cost'] ?? 0);
    const nodes = [this.toNode(planRoot as Record<string, unknown>, 'n1', totalCost)];
    return {
      format: 'json',
      content: JSON.stringify(raw, null, 2),
      raw,
      nodes,
    };
  }

  private toNode(node: Record<string, unknown>, id: string, total: number): ExecutionPlanNode {
    const cost = Number(node['Total Cost'] ?? 0);
    const children = Array.isArray(node['Plans'])
      ? (node['Plans'] as Array<Record<string, unknown>>).map((child, i) => this.toNode(child, `${id}-${i + 1}`, total))
      : [];
    const label = String(node['Node Type'] ?? 'Unknown');
    const relation = node['Relation Name'] ? ` on ${String(node['Relation Name'])}` : '';
    const rows = node['Actual Rows'] !== undefined ? ` rows=${String(node['Actual Rows'])}` : '';
    const time = node['Actual Total Time'] !== undefined ? ` time=${String(node['Actual Total Time'])}ms` : '';
    return {
      id,
      label: `${label}${relation}`,
      costShare: total > 0 ? Math.min(1, cost / total) : undefined,
      detail: `cost=${cost}${rows}${time}`,
      children,
    };
  }

  toTree(plan: ExecutionPlan): ExecutionPlanNode[] {
    if (plan.nodes && plan.nodes.length > 0) return plan.nodes;
    return this.fallback.toTree(plan);
  }
}

export class PostgresConnection implements DriverConnection {
  private readonly executor: QueryExecutor;
  private readonly metadata: MetadataProvider;
  private readonly ddl = new PostgresDdlGenerator(PG_DIALECT);
  private readonly typeMapper: TypeMapper;
  private closed = false;

  private readonly explainParser = new PostgresExplainParser();

  constructor(
    readonly id: string,
    readonly config: ConnectionConfig,
    private readonly pool: PgPoolLike,
    private serverVersion: string | null,
  ) {
    this.executor = new RelationalQueryExecutor(
      PG_DIALECT,
      (sql, params, ctx) => this.runQuery(sql, params, ctx),
      undefined,
      {
        parser: this.explainParser,
        // 走 rowMode:array 但**不**经过 toCell：计划是嵌套 JSON，不能被字符串化
        run: async (sql) => {
          const res = await this.pool.query({ text: PG_DIALECT.explainStatement(sql), rowMode: 'array' });
          return (res.rows as unknown[][])[0]?.[0] ?? null;
        },
      },
      config.readOnly,
    );
    this.metadata = new PgMetadataProvider(pool);
    this.typeMapper = createTypeMapper(config.dbType);
  }

  /** 归还连接；destroy 为真时丢弃这条连接（超时/事务状态不可信）。 */
  private releaseClient(client: PgClientLike, destroy: boolean): void {
    try {
      if (destroy) client.release?.(true);
      else client.release?.();
    } catch {
      /* 归还失败不影响主流程 */
    }
  }

  /** 把一条已借出的连接上的查询归一化；超时时通过 onTimeout 丢弃该连接。 */
  private async queryOn(
    client: PgClientLike,
    sql: string,
    values: unknown[],
    timeoutMs: number | undefined,
    onTimeout: () => void,
  ): Promise<RawQueryResult> {
    const started = Date.now();
    // 没有任何绑定参数时**不能**传 values：一旦带上 values，pg 会走扩展协议，
    // 而扩展协议不允许一次发多条语句（建表 + 建索引会被拒）。
    const res = await withQueryTimeout(
      client.query(values.length > 0 ? { text: sql, values, rowMode: 'array' } : { text: sql, rowMode: 'array' }),
      timeoutMs ?? 0,
      onTimeout,
    );
    const fields = res.fields ?? [];
    // DDL / 命令类语句可能没有 rows 字段，这里必须兜底，否则会抛
    // "Cannot read properties of undefined (reading 'map')" 这种难以定位的错误。
    const rawRows = (res.rows ?? []) as unknown[][];
    return {
      columns: fields.map((f) => ({ name: f.name, dataType: pgTypeName(f.dataTypeID) })),
      rows: rawRows.map((row) => row.map(toCell)),
      affectedRows: res.rowCount ?? 0,
      durationMs: Date.now() - started,
    };
  }

  /**
   * 统一出口：把 pg 的返回结构归一化成驱动无关的结果。
   *
   * 两点关键设计：
   *  1. **只读连接走 `BEGIN READ ONLY` 事务**：即使 isWriteStatement 判定有漏，
   *     数据库层也会拒绝写操作（错误码 25006），而不是只靠应用层拦截。
   *  2. **超时丢弃连接**：查询超时后不把仍在执行查询的连接还回池里（release(true)
   *     会关闭该 TCP 连接，PG 后端检测到断开即中止查询），避免脏连接被复用。
   */
  private async runQuery(sql: string, params?: CellValue[], ctx?: RunQueryContext): Promise<RawQueryResult> {
    if (this.closed) throw new PeanutError('CONNECTION_FAILED', '连接已关闭');
    try {
      const values = (params ?? []).map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p));
      const client = await this.pool.connect();
      if (!this.config.readOnly) {
        let destroy = false;
        try {
          return await this.queryOn(client, sql, values, ctx?.timeoutMs, () => {
            destroy = true;
          });
        } finally {
          this.releaseClient(client, destroy);
        }
      }

      // 只读连接：每个查询放进一个只读事务，失败/超时都要回滚后再归还
      let destroy = false;
      try {
        await client.query({ text: 'BEGIN READ ONLY' });
      } catch (e) {
        this.releaseClient(client, true);
        throw e;
      }
      try {
        const result = await this.queryOn(client, sql, values, ctx?.timeoutMs, () => {
          destroy = true;
        });
        try {
          await client.query({ text: 'ROLLBACK' });
        } catch {
          destroy = true;
        }
        return result;
      } catch (e) {
        try {
          await client.query({ text: 'ROLLBACK' });
        } catch {
          destroy = true;
        }
        throw e;
      } finally {
        this.releaseClient(client, destroy);
      }
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async ping(): Promise<{ latencyMs: number; serverVersion: string | null }> {
    const started = Date.now();
    const res = await this.pool.query({ text: 'SELECT version() AS v' });
    const rows = res.rows as Array<Record<string, unknown>>;
    this.serverVersion = String(rows[0]?.['v'] ?? '').split(' ').slice(0, 2).join(' ') || null;
    return { latencyMs: Date.now() - started, serverVersion: this.serverVersion };
  }

  getMetadata(): MetadataProvider {
    return this.metadata;
  }

  getQueryExecutor(): QueryExecutor {
    return this.executor;
  }

  getDdlGenerator(): ReturnType<DriverConnection['getDdlGenerator']> {
    return this.ddl;
  }

  getTypeMapper(): TypeMapper {
    return this.typeMapper;
  }

  getExplainParser(): ExplainParser {
    return this.explainParser;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pool.end();
  }
}

/** pg 的 type oid → 可读类型名（只映射常用类型，其余回退 oid 数字）。 */
const PG_OID_TYPES: Record<number, string> = {
  16: 'boolean', 17: 'bytea', 20: 'bigint', 21: 'smallint', 23: 'integer', 25: 'text',
  114: 'json', 700: 'real', 701: 'double precision', 1042: 'char', 1043: 'varchar',
  1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1186: 'interval',
  1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 1009: 'text[]', 1015: 'varchar[]',
  1016: 'bigint[]', 1007: 'integer[]', 1000: 'boolean[]', 1115: 'timestamp[]',
};

export function pgTypeName(oid: number | undefined): string {
  if (oid === undefined) return 'unknown';
  return PG_OID_TYPES[oid] ?? `oid:${oid}`;
}

/** PG 里无时区语义的类型 oid。 */
const PG_DATE_OID = 1082;
const PG_TIMESTAMP_OID = 1114;

/**
 * 注册 date / timestamp without time zone 的解析器：**原样返回字符串**。
 *
 * pg 默认把这两种类型解析成"本地时间"的 Date，随后 `toISOString()` 会按宿主机
 * UTC 偏移整体平移（TZ=Asia/Shanghai 时 DATE '2024-01-15' 会变成
 * '2024-01-14T16:00:00.000Z'），迁移时把错位值原样写进目标库 —— 静默数据损坏。
 * 这两个类型本就没有时区语义，字符串才是最忠实的表示。
 *
 * 注意：timestamptz(1184) 仍走默认解析器得到一个绝对时刻的 Date，
 * `toCell` 再转 ISO，带时区列的语义不会退化。
 */
function registerPgTypeParsers(pg: typeof import('pg')): void {
  const types = (pg as unknown as { types?: { setTypeParser?: (oid: number, fn: (v: string) => string) => void } })
    .types;
  if (!types?.setTypeParser) return;
  types.setTypeParser(PG_DATE_OID, (v) => v);
  types.setTypeParser(PG_TIMESTAMP_OID, (v) => v);
}

export class PostgresDriver implements DatabaseDriver {
  readonly dbType: DatabaseType;
  readonly name: string;
  readonly version = '1.0.0';
  readonly implemented = true;
  readonly capabilities: DriverCapabilities = {
    ...DEFAULT_CAPABILITIES,
    schemas: true,
    transactions: true,
    explain: true,
    streaming: true,
    serverSidePagination: true,
    ddl: true,
    cdc: false,
  };

  /** KingbaseES 走同一套 PG 协议实现。 */
  constructor(dbType: DatabaseType = 'postgresql', name = 'PostgreSQL') {
    this.dbType = dbType;
    this.name = name;
  }

  getInfo(): DbTypeInfo {
    return getDbTypeInfo(this.dbType);
  }

  private async buildPool(config: ConnectionConfig): Promise<{ pool: PgPoolLike; version: string | null }> {
    const target = resolvePostgresTarget(config);
    let pg: typeof import('pg');
    try {
      pg = (await import('pg')) as unknown as typeof import('pg');
    } catch (e) {
      throw new PeanutError('DRIVER_NOT_IMPLEMENTED', 'PostgreSQL 驱动依赖 pg 未安装', {
        hint: '请在项目根目录执行 pnpm install 以安装 pg',
        cause: String(e),
      });
    }
    const Pool = (pg as unknown as { Pool: new (cfg: Record<string, unknown>) => PgPoolLike }).Pool ??
      (pg as unknown as { default?: { Pool: new (cfg: Record<string, unknown>) => PgPoolLike } }).default?.Pool;
    if (!Pool) throw new PeanutError('DRIVER_NOT_IMPLEMENTED', 'pg 模块未导出 Pool');

    registerPgTypeParsers(pg);

    const pool = new Pool({
      host: target.host,
      port: target.port,
      database: target.database ?? undefined,
      user: target.user ?? undefined,
      password: target.password ?? undefined,
      ssl: target.ssl,
      max: Number(config.extraParams?.['poolMax'] ?? 4),
      connectionTimeoutMillis: Number(config.extraParams?.['connectTimeoutMs'] ?? 15_000),
      idleTimeoutMillis: 30_000,
      application_name: 'peanutsprout',
    });
    // 建一个连接确认可用，并取回版本号：连不上时应立即失败而不是等到首次查询
    const client = await pool.connect();
    let version: string | null = null;
    try {
      const res = await client.query({ text: 'SELECT version() AS v' });
      version = String((res.rows as Array<Record<string, unknown>>)[0]?.['v'] ?? '').split(' ').slice(0, 2).join(' ') || null;
    } finally {
      // pg 的 client 需要 release；连接池场景下 release 由 pg 提供
      const releasable = client as unknown as { release?: () => void };
      releasable.release?.();
    }
    return { pool, version };
  }

  async connect(config: ConnectionConfig): Promise<DriverConnection> {
    try {
      const { pool, version } = await this.buildPool(config);
      return new PostgresConnection(`pg-${config.id}-${randomUUID().slice(0, 8)}`, config, pool, version);
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const started = Date.now();
    let pool: PgPoolLike | null = null;
    try {
      const built = await this.buildPool(config);
      pool = built.pool;
      return {
        ok: true,
        latencyMs: Date.now() - started,
        serverVersion: built.version,
        message: `连接成功（${built.version ?? 'PostgreSQL'}）`,
      };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        serverVersion: null,
        message: normalizeError(e).message,
      };
    } finally {
      await pool?.end().catch(() => undefined);
    }
  }
}
