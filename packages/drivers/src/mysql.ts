/**
 * 花生苗数据库管理工具 - MySQL 协议族驱动
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 基于纯 JS 的 `mysql2`，无原生编译依赖。一套实现同时服务
 * MySQL / MariaDB / TiDB / OceanBase —— 它们共用 MySQL 线协议。
 * 元数据取自 information_schema，因此对上述分支都成立。
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
import { quoteIdentBacktick, quoteQualified } from './identifiers.js';
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

/** 各分支的默认端口。 */
const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  mariadb: 3306,
  tidb: 4000,
  oceanbase: 2881,
};

/**
 * MySQL 协议族能识别的连接串协议头。
 * MariaDB / TiDB / OceanBase 共用 MySQL 线协议，因此彼此的 scheme 互相兼容；
 * 但绝不能让"不认识的 scheme"被静默忽略 —— 那会让 host 掉回 localhost，
 * 用户以为连的是远端生产库。
 */
const MYSQL_SCHEMES = ['mysql', 'mariadb', 'tidb', 'oceanbase'] as const;

/**
 * 需要按"墙上时间字符串"读取的 MySQL 时间类型。
 *
 * DATE / DATETIME 没有时区语义：mysql2 会把它们按本地时区解析成 Date，
 * 再用 toISOString() 就会整体平移（静默数据损坏），因此让驱动原样给字符串。
 * TIMESTAMP 是带时区语义的类型（服务端按会话时区换算），继续返回 Date 以保留绝对时刻。
 */
export const MYSQL_DATE_STRING_TYPES = ['DATE', 'DATETIME'] as const;

/** 解析连接目标：连接串优先，其次分项配置，最后才回退默认值。 */
export function resolveMysqlTarget(config: ConnectionConfig): NetworkTarget {
  const url = config.connectionUrl?.trim();
  let host = config.host?.trim() ?? '';
  let port = Number(config.port ?? 0);
  let database = config.databaseName?.trim() ?? '';
  let user = config.username?.trim() ?? '';
  let password = config.password ?? '';

  if (url) {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url)?.[1]?.toLowerCase();
    const declared = getDbTypeInfo(config.dbType).urlScheme.toLowerCase();
    const accepted = new Set<string>([...MYSQL_SCHEMES, declared]);
    if (!scheme || !accepted.has(scheme)) {
      // 绝不静默回落：连接串被忽略会让用户以为连的是远端库，实际连到 localhost
      throw new PeanutError(
        'VALIDATION_FAILED',
        scheme
          ? `连接串协议 "${scheme}://" 与数据库类型 ${config.dbType} 不匹配（支持: ${[...accepted].join(', ')}）`
          : `无法识别 MySQL 连接串的协议头: ${redactConnectionUrl(url) ?? '[已隐藏]'}`,
        { scheme: scheme ?? null, dbType: config.dbType, supported: [...accepted] },
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new PeanutError('VALIDATION_FAILED', `无法解析 MySQL 连接串: ${redactConnectionUrl(url) ?? '[已隐藏]'}`);
    }
    if (!host) host = hostnameOf(parsed);
    if (!port && parsed.port) port = Number(parsed.port);
    if (!database) database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!user) user = decodeURIComponent(parsed.username);
    if (!password) password = decodeURIComponent(parsed.password);
  }

  const fallbackPort = DEFAULT_PORTS[config.dbType] ?? 3306;
  const { host: h, port: p } = requireHost({ host: host || 'localhost', port: port || fallbackPort }, 'MySQL');
  const sslFlag = flagOf(config.extraParams?.['ssl']);
  const ssl = config.ssl?.enabled || sslFlag ? { rejectUnauthorized: config.ssl?.rejectUnauthorized !== false } : undefined;

  return {
    host: h,
    port: p,
    // MySQL 不强制库名（可以连上再 USE），但迁移场景需要显式库
    database: database || null,
    user: user || 'root',
    password,
    ssl,
  };
}

const MYSQL_DIALECT: RelationalDialect = {
  quote: quoteIdentBacktick,
  qualified: (schema, name) => quoteQualified(schema, name, quoteIdentBacktick),
  limitClause: (maxRows) => `LIMIT ${maxRows}`,
  renderType: (column) => column.dataType,
  explainStatement: (sql) => `EXPLAIN ${sql}`,
};

/**
 * MySQL 的改列语法与 PG 完全不同：用 MODIFY COLUMN 一次给出完整新定义。
 */
export class MysqlDdlGenerator extends RelationalDdlGenerator {
  override alterColumn(schema: string, table: string, from: ColumnInfo, to: ColumnInfo): string {
    const target = this.dialect.qualified(schema, table);
    const statements: string[] = [];
    if (from.name !== to.name) {
      // MySQL 8 支持 RENAME COLUMN；MariaDB 10.5+ 同样支持
      statements.push(
        `ALTER TABLE ${target} RENAME COLUMN ${this.dialect.quote(from.name)} TO ${this.dialect.quote(to.name)};`,
      );
    }
    if (from.dataType !== to.dataType || from.nullable !== to.nullable || from.defaultValue !== to.defaultValue) {
      const parts = [this.dialect.quote(to.name), this.dialect.renderType(to)];
      parts.push(to.nullable === false ? 'NOT NULL' : 'NULL');
      if (to.defaultValue !== null && to.defaultValue !== undefined && to.defaultValue !== '') {
        parts.push(`DEFAULT ${to.defaultValue}`);
      }
      statements.push(`ALTER TABLE ${target} MODIFY COLUMN ${parts.join(' ')};`);
    }
    return statements.length > 0 ? statements.join('\n') : `-- 未检测到需要变更的属性`;
  }

  override dropIndex(schema: string, table: string, indexName: string): string {
    // MySQL 的 DROP INDEX 必须带表名
    return `DROP INDEX ${this.dialect.quote(indexName)} ON ${this.dialect.qualified(schema, table)};`;
  }
}

export interface MysqlConnLike {
  query(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<[unknown, unknown[]]>;
  execute(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<[unknown, unknown[]]>;
  end(): Promise<void>;
  destroy(): void;
  /** 归还连接池句柄 */
  release?(): void;
}

export interface MysqlPoolLike {
  query(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<[unknown, unknown[]]>;
  execute(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<[unknown, unknown[]]>;
  getConnection(): Promise<MysqlConnLike>;
  end(): Promise<void>;
}

class MysqlMetadataProvider implements MetadataProvider {
  constructor(private readonly pool: MysqlPoolLike) {}

  private async rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const [result] = await this.pool.query({ sql, values: params });
    return (result as Array<Record<string, unknown>>) ?? [];
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const rows = await this.rows(
      `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset
         FROM information_schema.SCHEMATA
        WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys')
        ORDER BY SCHEMA_NAME`,
    );
    return rows.map((r) => ({ name: String(r['name']), comment: (r['charset'] as string) ?? null }));
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const rows = await this.rows(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_COMMENT AS comment, TABLE_ROWS AS rows_est
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [schema],
    );
    return rows.map((r) => ({
      schema,
      name: String(r['name']),
      kind: String(r['type']).toUpperCase().includes('VIEW') ? ('view' as const) : ('table' as const),
      comment: ((r['comment'] as string) || null) as string | null,
      rowCount: Number(r['rows_est'] ?? 0) || null,
    }));
  }

  async listViews(schema: string): Promise<TableInfo[]> {
    return (await this.listTables(schema)).filter((t) => t.kind === 'view');
  }

  async listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const rows = await this.rows(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS data_type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS default_value, COLUMN_KEY AS col_key, ORDINAL_POSITION AS ordinal,
              COLUMN_COMMENT AS comment, EXTRA AS extra
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [schema, table],
    );
    return rows.map((r) => ({
      schema,
      table,
      name: String(r['name']),
      dataType: String(r['data_type']),
      nullable: String(r['nullable']).toUpperCase() === 'YES',
      defaultValue: (r['default_value'] as string) ?? null,
      isPrimaryKey: String(r['col_key'] ?? '').toUpperCase() === 'PRI',
      comment: ((r['comment'] as string) || null) as string | null,
      ordinal: Number(r['ordinal'] ?? 0),
    }));
  }

  async listIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const rows = await this.rows(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq,
              COLUMN_NAME AS column_name
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [schema, table],
    );
    const byName = new Map<string, { columns: string[]; unique: boolean }>();
    for (const r of rows) {
      const name = String(r['name']);
      const entry = byName.get(name) ?? { columns: [], unique: Number(r['non_unique']) === 0 };
      if (r['column_name']) entry.columns.push(String(r['column_name']));
      byName.set(name, entry);
    }
    return [...byName.entries()].map(([name, info]) => ({
      schema,
      table,
      name,
      columns: info.columns,
      unique: info.unique,
      primary: name.toUpperCase() === 'PRIMARY',
    }));
  }

  async listConstraints(schema: string, table: string): Promise<ConstraintInfo[]> {
    const rows = await this.rows(
      `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS kind,
              GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS cols,
              kcu.REFERENCED_TABLE_NAME AS ref_table,
              kcu.REFERENCED_COLUMN_NAME AS ref_column
         FROM information_schema.TABLE_CONSTRAINTS tc
    LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME
        WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
        GROUP BY tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
        ORDER BY tc.CONSTRAINT_NAME`,
      [schema, table],
    );
    const kindOf = (raw: string): ConstraintInfo['type'] => {
      const k = raw.toUpperCase();
      if (k.includes('PRIMARY')) return 'primary_key';
      if (k.includes('FOREIGN')) return 'foreign_key';
      if (k.includes('UNIQUE')) return 'unique';
      return 'check';
    };
    return rows.map((r) => {
      const type = kindOf(String(r['kind']));
      const cols = r['cols'] ? String(r['cols']) : '';
      const refTable = r['ref_table'] as string | null;
      const refColumn = r['ref_column'] as string | null;
      const definition =
        type === 'foreign_key' && refTable
          ? `FOREIGN KEY (${cols}) REFERENCES \`${refTable}\` (\`${refColumn ?? ''}\`)`
          : type === 'primary_key'
            ? `PRIMARY KEY (${cols})`
            : type === 'unique'
              ? `UNIQUE (${cols})`
              : `CHECK (${cols})`;
      return { schema, table, name: String(r['name']), type, definition };
    });
  }

  async listProcedures(schema: string): Promise<Array<{ name: string; kind: 'procedure' | 'function' }>> {
    const rows = await this.rows(
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind
         FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ?
        ORDER BY ROUTINE_NAME`,
      [schema],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      kind: String(r['kind']).toUpperCase() === 'PROCEDURE' ? ('procedure' as const) : ('function' as const),
    }));
  }

  async listTriggers(schema: string): Promise<Array<{ name: string; table: string | null }>> {
    const rows = await this.rows(
      `SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS table_name
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = ?
        ORDER BY TRIGGER_NAME`,
      [schema],
    );
    return rows.map((r) => ({ name: String(r['name']), table: (r['table_name'] as string) ?? null }));
  }
}

/** MySQL 的 EXPLAIN 返回的是行表格（不是 JSON），这里转成结构化节点。 */
export class MysqlExplainParser implements ExplainParser {
  private readonly fallback = new TextExplainParser(
    (raw) =>
      Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
            .map((r) => Object.entries(r).map(([k, v]) => `${k}: ${String(v)}`).join(' | '))
            .join('\n')
        : JSON.stringify(raw, null, 2),
  );

  parse(raw: unknown): ExecutionPlan {
    const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    const content =
      rows.length > 0
        ? rows.map((r) => Object.entries(r).map(([k, v]) => `${k}: ${String(v)}`).join(' | ')).join('\n')
        : JSON.stringify(raw, null, 2);
    const nodes: ExecutionPlanNode[] = rows.map((r, i) => {
      const table = r['table'] ?? r['TABLE'] ?? r['table_name'];
      const type = r['type'] ?? r['TYPE'] ?? r['select_type'];
      const rowsEst = r['rows'] ?? r['ROWS'];
      const extra = r['Extra'] ?? r['EXTRA'] ?? '';
      const accessType = String(type ?? 'unknown');
      return {
        id: `mysql-${i + 1}`,
        label: `${accessType}${table ? ` on ${String(table)}` : ''}`,
        detail: rowsEst !== undefined ? `rows≈${String(rowsEst)}${extra ? ` · ${String(extra)}` : ''}` : String(extra || ''),
        children: [],
      };
    });
    return { format: rows.length > 0 ? 'json' : 'text', content, raw, nodes };
  }

  toTree(plan: ExecutionPlan): ExecutionPlanNode[] {
    if (plan.nodes && plan.nodes.length > 0) return plan.nodes;
    return this.fallback.toTree(plan);
  }
}

export class MysqlConnection implements DriverConnection {
  private readonly executor: QueryExecutor;
  private readonly metadata: MetadataProvider;
  private readonly ddl = new MysqlDdlGenerator(MYSQL_DIALECT);
  private readonly typeMapper: TypeMapper;
  private closed = false;

  private readonly explainParser = new MysqlExplainParser();

  constructor(
    readonly id: string,
    readonly config: ConnectionConfig,
    private readonly pool: MysqlPoolLike,
    private serverVersion: string | null,
  ) {
    this.executor = new RelationalQueryExecutor(
      MYSQL_DIALECT,
      (sql, params, ctx) => this.runQuery(sql, params, ctx),
      undefined,
      {
        parser: this.explainParser,
        run: async (sql) => {
          const [rows] = await this.pool.query({ sql: MYSQL_DIALECT.explainStatement(sql), rowsAsArray: false });
          return rows;
        },
      },
      config.readOnly,
    );
    this.metadata = new MysqlMetadataProvider(pool);
    this.typeMapper = createTypeMapper(config.dbType);
  }

  /** 在一条已借出的连接上执行查询并归一化；超时时由 onTimeout 丢弃该连接。 */
  private async queryOn(
    conn: MysqlConnLike,
    sql: string,
    values: unknown[],
    timeoutMs: number | undefined,
    onTimeout: () => void,
  ): Promise<RawQueryResult> {
    const started = Date.now();
    // rowsAsArray 让 mysql2 直接给数组，省掉一次字段重排
    const [result, fields] = await withQueryTimeout(
      conn.query({ sql, values, rowsAsArray: true }),
      timeoutMs ?? 0,
      onTimeout,
    );
    const columns = (fields ?? []).map((f) => ({
      name: (f as { name?: string }).name ?? '?',
      dataType: mysqlTypeName(f as { type?: number; columnType?: number; characterSet?: number }),
    }));
    if (Array.isArray(result)) {
      const rawRows = result as unknown[][];
      return {
        columns,
        rows: rawRows.map((row) => row.map(toCell)),
        affectedRows: 0,
        durationMs: Date.now() - started,
      };
    }
    const header = result as { affectedRows?: number; constructor?: { name?: string } };
    // OK packet：DML / DDL
    return {
      columns: [],
      rows: [],
      affectedRows: Number(header.affectedRows ?? 0),
      durationMs: Date.now() - started,
    };
  }

  /**
   * 统一出口：把 mysql2 的返回结构归一化成驱动无关的结果。
   *
   * 两点关键设计：
   *  1. **只读连接走 `START TRANSACTION READ ONLY` 事务**：即使 isWriteStatement
   *     判定有漏，MySQL 也会以 ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION 拒绝写操作。
   *     用事务级只读而不是 SET SESSION，是为了不污染归还后可能被复用的连接。
   *  2. **超时丢弃连接**：查询超时后 `conn.destroy()` 直接断开这条连接，
   *     而不是把仍在跑查询的连接 release 回池里。
   */
  private async runQuery(sql: string, params?: CellValue[], ctx?: RunQueryContext): Promise<RawQueryResult> {
    if (this.closed) throw new PeanutError('CONNECTION_FAILED', '连接已关闭');
    try {
      const values = (params ?? []).map((p) => (p instanceof Uint8Array ? Buffer.from(p) : p));
      const conn = await this.pool.getConnection();
      if (!this.config.readOnly) {
        let destroy = false;
        try {
          return await this.queryOn(conn, sql, values, ctx?.timeoutMs, () => {
            destroy = true;
          });
        } finally {
          if (destroy) conn.destroy();
          else conn.release?.();
        }
      }

      // 只读连接：事务级只读，失败/超时都回滚后再归还（或直接销毁）
      let destroy = false;
      try {
        await conn.query({ sql: 'START TRANSACTION READ ONLY' });
      } catch (e) {
        conn.destroy();
        throw e;
      }
      try {
        const result = await this.queryOn(conn, sql, values, ctx?.timeoutMs, () => {
          destroy = true;
        });
        try {
          await conn.query({ sql: 'ROLLBACK' });
        } catch {
          destroy = true;
        }
        return result;
      } catch (e) {
        try {
          await conn.query({ sql: 'ROLLBACK' });
        } catch {
          destroy = true;
        }
        throw e;
      } finally {
        if (destroy) conn.destroy();
        else conn.release?.();
      }
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async ping(): Promise<{ latencyMs: number; serverVersion: string | null }> {
    const started = Date.now();
    const [rows] = await this.pool.query({ sql: 'SELECT VERSION() AS v', rowsAsArray: true });
    const first = (rows as unknown[][])[0];
    this.serverVersion = first?.[0] !== undefined ? String(first[0]) : null;
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

/** mysql2 的字段类型码 → 类型名。names 来自 MySQL 协议的列定义。 */
const MYSQL_TYPE_NAMES: Record<number, string> = {
  0: 'decimal', 1: 'tinyint', 2: 'smallint', 3: 'int', 4: 'float', 5: 'double',
  6: 'null', 7: 'timestamp', 8: 'bigint', 9: 'mediumint', 10: 'date', 11: 'time',
  12: 'datetime', 13: 'year', 14: 'date', 15: 'varchar', 16: 'bit', 17: 'timestamp',
  18: 'datetime', 19: 'time', 245: 'json', 246: 'newdecimal', 247: 'enum',
  248: 'set', 249: 'tinyblob', 250: 'mediumblob', 251: 'longblob', 252: 'blob',
  253: 'var_string', 254: 'char', 255: 'geometry',
};

export function mysqlTypeName(field: { type?: number; columnType?: number }): string {
  const code = field.type ?? field.columnType;
  if (code === undefined) return 'unknown';
  return MYSQL_TYPE_NAMES[code] ?? `code:${code}`;
}

/**
 * 归一化 mysql2 建池参数。
 *
 * 单独抽出来是为了让"带时区语义"的关键开关可被单测直接验证（本机没有可用的
 * MySQL 服务端时，集成测试会跳过，但参数错了绝不能悄悄放过）。
 */
export function mysqlPoolOptions(config: ConnectionConfig): Record<string, unknown> {
  const target = resolveMysqlTarget(config);
  return {
    host: target.host,
    port: target.port,
    database: target.database ?? undefined,
    user: target.user ?? undefined,
    password: target.password ?? undefined,
    ssl: target.ssl,
    connectionLimit: Number(config.extraParams?.['poolMax'] ?? 4),
    connectTimeout: Number(config.extraParams?.['connectTimeoutMs'] ?? 15_000),
    // 迁移大字段时不要因为包过大被截断
    maxPreparedStatements: 100,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // DATE/DATETIME 无时区语义：原样字符串返回，避免 toISOString() 按本地时区平移；
    // TIMESTAMP 带时区语义，保持 Date 以保留绝对时刻。
    dateStrings: [...MYSQL_DATE_STRING_TYPES],
    multipleStatements: false,
    charset: config.extraParams?.['charset'] ?? 'utf8mb4',
  };
}

export class MysqlDriver implements DatabaseDriver {
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

  /** 同一实现服务 MySQL / MariaDB / TiDB / OceanBase。 */
  constructor(dbType: DatabaseType = 'mysql', name = 'MySQL') {
    this.dbType = dbType;
    this.name = name;
  }

  getInfo(): DbTypeInfo {
    return getDbTypeInfo(this.dbType);
  }

  private async buildPool(config: ConnectionConfig): Promise<{ pool: MysqlPoolLike; version: string | null }> {
    let mysql: typeof import('mysql2/promise');
    try {
      mysql = (await import('mysql2/promise')) as unknown as typeof import('mysql2/promise');
    } catch (e) {
      throw new PeanutError('DRIVER_NOT_IMPLEMENTED', 'MySQL 驱动依赖 mysql2 未安装', {
        hint: '请在项目根目录执行 pnpm install 以安装 mysql2',
        cause: String(e),
      });
    }
    const createPool = (mysql as unknown as {
      createPool: (cfg: Record<string, unknown>) => MysqlPoolLike;
    }).createPool;
    if (typeof createPool !== 'function') {
      throw new PeanutError('DRIVER_NOT_IMPLEMENTED', 'mysql2/promise 未导出 createPool');
    }

    const pool = createPool(mysqlPoolOptions(config));

    const conn = await pool.getConnection();
    let version: string | null = null;
    try {
      const [rows] = await conn.query({ sql: 'SELECT VERSION() AS v', rowsAsArray: true });
      const first = (rows as unknown[][])[0];
      version = first?.[0] !== undefined ? String(first[0]) : null;
    } finally {
      (conn as unknown as { release?: () => void }).release?.();
    }
    return { pool, version };
  }

  async connect(config: ConnectionConfig): Promise<DriverConnection> {
    try {
      const { pool, version } = await this.buildPool(config);
      return new MysqlConnection(`mysql-${config.id}-${randomUUID().slice(0, 8)}`, config, pool, version);
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const started = Date.now();
    let pool: MysqlPoolLike | null = null;
    try {
      const built = await this.buildPool(config);
      pool = built.pool;
      return {
        ok: true,
        latencyMs: Date.now() - started,
        serverVersion: built.version,
        message: `连接成功（${built.version ?? 'MySQL'}）`,
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
