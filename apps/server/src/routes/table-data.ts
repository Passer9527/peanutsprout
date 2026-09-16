/**
 * 花生苗数据库管理工具 - 表数据编辑路由（Excel 式增删改查）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个模块只做一件事：让界面能像操作表格一样读、增、改、删某一张表的数据。
 *
 * ## 为什么更新/删除必须带"定位符"
 *
 * 界面上的"改一格、删一行"要落到数据库，就必须能**精确指向一行**。如果只按
 * "用户看到的那几个字段"去拼 WHERE，一张有重复值的表就可能被一次改掉很多行 ——
 * 而界面只显示了改一行，用户根本看不出事故。所以这里：
 *
 *   1. 服务端自己解析定位符：优先主键；没有主键时退到一个**全部列都 NOT NULL
 *      的唯一索引**（唯一 + 非空才保证能定位到至多一行，也才不会被 NULL 的
 *      `= NULL` 语义坑到）；
 *   2. 两者都没有 → `kind: 'none'`，此时**明确拒绝**更新与删除，只允许读和新增，
 *      并把原因回给界面展示。绝不退化成"按内容模糊匹配"。
 *   3. 更新/删除后校验受影响行数：不是 1 就报错，让"悄悄改了多行"暴露出来。
 *
 * ## 值一律走参数绑定
 *
 * 列名/表名走驱动的标识符白名单引用（`quoteFor`），值一律用绑定参数
 * （`placeholderFor`，PostgreSQL 系是 `$1..$n`，其余是 `?`）。
 * 没有任何一处把用户的值拼进 SQL 文本。
 */

import { z } from 'zod';
import { PeanutError, normalizeError, notFound, type CellValue, type ColumnInfo, type IndexInfo } from '@peanutsprout/core';
import { assertCanWrite, assertConnectionVisible } from '@peanutsprout/auth';
import { placeholderFor, quoteFor } from '@peanutsprout/migration';
import type { DriverConnection } from '@peanutsprout/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth, userAgent } from '../http.js';

/* ------------------------------------------------------------------ 常量 */

/** 单页最多返回多少行。界面自己还会限制得更小。 */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

/**
 * 统计行数时最多数到多少行。
 *
 * `SELECT COUNT(*)` 在 MySQL InnoDB 这类引擎上是全表扫描，百万行的表会让
 * "打开表"直接卡住。这里改成 `SELECT COUNT(*) FROM (SELECT 1 FROM t LIMIT cap+1)`：
 * 扫描量被硬性封顶在 cap+1 行。数到 cap+1 就说明"比 cap 多"，
 * 此时返回 `total: null`，界面显示"行数未知"——而不是给一个会误导翻页的假数字。
 */
const COUNT_CAP = 50_000;

/** 审计里记录的 SQL 片段上限 */
const AUDIT_SQL_MAX = 2000;

/* ------------------------------------------------------------------ 校验 */

const tableRef = {
  connectionId: z.number().int().positive('请选择连接'),
  schema: z.string().max(128).default(''),
  table: z.string().min(1, '请选择数据表').max(128),
};

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const rowsSchema = z.object({
  ...tableRef,
  page: z.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  orderBy: z.string().max(128).nullish(),
  orderDir: z.enum(['asc', 'desc']).optional(),
});

const insertSchema = z.object({
  ...tableRef,
  values: z.record(z.string().max(128), valueSchema),
});

const updateSchema = z.object({
  ...tableRef,
  key: z.record(z.string().max(128), valueSchema),
  changes: z.record(z.string().max(128), valueSchema),
});

const deleteSchema = z.object({
  ...tableRef,
  keys: z.array(z.record(z.string().max(128), valueSchema)).min(1, '请至少选择一行').max(1000),
});

/* ------------------------------------------------------------------ 定位符 */

export type LocatorKind = 'primary_key' | 'unique_index' | 'none';

export interface RowLocator {
  kind: LocatorKind;
  /** 参与定位的列，按索引内顺序 */
  columns: string[];
  indexName?: string;
}

/**
 * 解析这张表"一行"的定位方式。
 *
 * 只用**能保证至多匹配一行**的东西：主键，或「唯一 + 全部列 NOT NULL」的索引。
 * 为什么要求 NOT NULL：`WHERE col = ?` 在 col 为 NULL 时永远不成立
 * （SQL 三值逻辑），拿一个可能为 NULL 的列做定位会漏掉行；而 `IS NULL`
 * 又匹配不到"具体是哪一行"。非空唯一索引没有这个歧义。
 *
 * 抽成导出的纯函数（依赖注入元数据读取）是为了能单测 —— 这段判定错了，
 * 后果是静默改多行，属于必须被测住的逻辑。
 */
export async function resolveRowLocator(
  listColumns: () => Promise<ColumnInfo[]>,
  listIndexes: () => Promise<IndexInfo[]>,
): Promise<{ locator: RowLocator; columns: ColumnInfo[] }> {
  const columns = await listColumns();
  const byName = new Map(columns.map((c) => [c.name, c]));
  const primary = columns
    .filter((c) => c.isPrimaryKey)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => c.name);
  if (primary.length > 0) {
    return { locator: { kind: 'primary_key', columns: primary }, columns };
  }

  let indexes: IndexInfo[] = [];
  try {
    indexes = await listIndexes();
  } catch {
    // 某些驱动/视图不支持列出索引：那就当作"没有可用唯一索引"，
    // 而不是把异常抛给调用方导致整张表打不开。
    indexes = [];
  }
  for (const index of indexes) {
    if (!index.unique || index.primary) continue;
    const names = index.columns.filter((n) => n.length > 0);
    if (names.length === 0) continue;
    // 唯一索引的每一列都必须存在且明确非空
    const usable = names.every((name) => {
      const column = byName.get(name);
      return column !== undefined && column.nullable === false;
    });
    if (usable) {
      return { locator: { kind: 'unique_index', columns: names, indexName: index.name }, columns };
    }
  }
  return { locator: { kind: 'none', columns: [] }, columns };
}

/* ------------------------------------------------------------------ SQL 构造 */

/** 列名 → 带白名单校验的引用；拒绝表里不存在的列。 */
export function buildColumnList(conn: DriverConnection, names: string[], known: Set<string>): string[] {
  return names.map((name) => {
    if (!known.has(name)) {
      throw new PeanutError('VALIDATION_FAILED', `数据表中没有这一列: ${name}`);
    }
    // quoteFor(conn, null, name) 会对标识符做白名单校验，非法名直接报错
    return quoteFor(conn, null, name);
  });
}

/**
 * 构造 `UPDATE ... SET ... WHERE ...`。
 *
 * `changes` 只包含**真正改动过的列** —— 把没改的列也写进 SET 会覆盖掉
 * 别人在这期间的并发修改，属于不必要的写放大。
 */
export function buildUpdate(
  conn: DriverConnection,
  schema: string,
  table: string,
  changes: Array<[string, CellValue]>,
  key: Array<[string, CellValue]>,
): { sql: string; params: CellValue[] } {
  if (changes.length === 0) {
    throw new PeanutError('VALIDATION_FAILED', '没有需要修改的列');
  }
  const params: CellValue[] = [];
  const setParts = changes.map(([column, value]) => {
    params.push(value);
    return `${quoteFor(conn, null, column)} = ${placeholderFor(conn, params.length - 1)}`;
  });
  const whereParts = key.map(([column, value]) => {
    // NULL 不能用 `= ?`（永远不成立），必须走 IS NULL
    if (value === null) return `${quoteFor(conn, null, column)} IS NULL`;
    params.push(value);
    return `${quoteFor(conn, null, column)} = ${placeholderFor(conn, params.length - 1)}`;
  });
  return {
    sql: `UPDATE ${quoteFor(conn, schema || null, table)} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`,
    params,
  };
}

/** 构造 `DELETE FROM ... WHERE ...` */
export function buildDelete(
  conn: DriverConnection,
  schema: string,
  table: string,
  key: Array<[string, CellValue]>,
): { sql: string; params: CellValue[] } {
  const params: CellValue[] = [];
  const whereParts = key.map(([column, value]) => {
    if (value === null) return `${quoteFor(conn, null, column)} IS NULL`;
    params.push(value);
    return `${quoteFor(conn, null, column)} = ${placeholderFor(conn, params.length - 1)}`;
  });
  return {
    sql: `DELETE FROM ${quoteFor(conn, schema || null, table)} WHERE ${whereParts.join(' AND ')}`,
    params,
  };
}

/**
 * 校验客户端给的 `key` 是否恰好覆盖定位符的列。
 *
 * 少给一列 → 可能匹配多行；多给一列 → 客户端在用过期的定位符。
 * 两种情况都必须拒绝，而不是"随便挑一列能用就用"。
 */
export function assertKeyMatchesLocator(
  locator: RowLocator,
  key: Record<string, CellValue>,
): void {
  if (locator.kind === 'none') {
    throw new PeanutError(
      'VALIDATION_FAILED',
      '这张表没有主键，也没有「唯一且全部非空」的索引，无法安全地定位到单独一行；已拒绝更新/删除。请改用 SQL 开发页。',
      { locatorKind: locator.kind },
    );
  }
  const expected = [...locator.columns].sort();
  const actual = Object.keys(key).sort();
  if (expected.length !== actual.length || expected.some((name, i) => name !== actual[i])) {
    throw new PeanutError('VALIDATION_FAILED', '定位键与表的定位方式不一致，请刷新后重试', {
      expected: locator.columns,
      actual: Object.keys(key),
    });
  }
}

/** 把 key 对象整理成"按定位符列顺序"的键值对，保证 SQL 与参数一一对应。 */
export function orderedKey(
  locator: RowLocator,
  key: Record<string, CellValue>,
): Array<[string, CellValue]> {
  return locator.columns.map((column) => [column, key[column] ?? null]);
}

/* ------------------------------------------------------------------ 路由 */

export async function registerTableDataRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const actorOf = (req: FastifyRequest) => {
    const auth = authOf(req);
    return { userId: auth.user.id, username: auth.user.username };
  };

  /** 连接 + 可见性 + 配置解析：所有接口共用的前置。 */
  const resolve = (req: FastifyRequest, connectionId: number) => {
    const auth = authOf(req);
    const dto = ctx.pdb.connections.get(connectionId);
    if (!dto) throw notFound('连接', connectionId);
    // 与其余子资源接口一致：不存在与未授权都返回同一个 NOT_FOUND，防枚举
    assertConnectionVisible(auth, connectionId);
    const config = ctx.pdb.connections.getConfig(connectionId);
    if (!config) throw notFound('连接', connectionId);
    return { auth, dto, config };
  };

  /**
   * 写操作的统一闸门 + 被拒绝时的审计。
   *
   * 与 `/query/execute` 完全同一套判定（`assertCanWrite` 内含权限、连接只读、
   * 资源级写授权），并且**被拒绝的尝试也要留痕** —— 表数据编辑器是最容易被
   * 拿来试探写权限的入口，不留痕等于给了无成本试错空间。
   */
  const ensureWritable = (
    req: FastifyRequest,
    connectionId: number,
    dto: ReturnType<AppContext['pdb']['connections']['get']>,
    detail: Record<string, unknown>,
  ): void => {
    const auth = authOf(req);
    try {
      assertCanWrite(auth, connectionId, dto);
    } catch (error) {
      const err = normalizeError(error);
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'write',
        resourceType: 'table_row',
        resourceId: String(connectionId),
        connectionId,
        status: 'denied',
        errorMessage: '表数据写入被拒绝',
        detail: { ...detail, gate: err.code },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      throw error;
    }
  };

  /** 列元信息 + 可写性 + 定位符（界面先渲染表头与只读提示，再拉数据） */
  app.post('/data/table/columns', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(z.object(tableRef), req.body);
    const { auth, dto, config } = resolve(req, body.connectionId);

    const meta = await ctx.manager.withConnection(config, async (conn) => {
      const resolved = await resolveRowLocator(
        () => conn.getMetadata().listColumns(body.schema, body.table),
        () => conn.getMetadata().listIndexes(body.schema, body.table),
      );
      return resolved;
    });
    if (meta.columns.length === 0) throw notFound('数据表', `${body.schema}.${body.table}`);

    // 只读原因按优先级给出一个：没权限 > 连接只读 > 没有定位符。
    // 这里只做"预期"判断（界面用来提前禁用按钮），真正的拦截仍在写接口里。
    let readOnlyReason: 'no_primary_key' | 'no_permission' | 'connection_readonly' | null = null;
    if (!auth.permissions.includes('query.write')) readOnlyReason = 'no_permission';
    else if (dto?.isReadOnly) readOnlyReason = 'connection_readonly';
    else if (meta.locator.kind === 'none') readOnlyReason = 'no_primary_key';

    return reply.send({
      columns: meta.columns,
      locator: meta.locator,
      editable: readOnlyReason === null,
      readOnlyReason,
    });
  });

  app.post('/data/table/rows', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(rowsSchema, req.body);
    const { auth, dto, config } = resolve(req, body.connectionId);

    const pageSize = body.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = body.page ?? 1;
    const offset = (page - 1) * pageSize;

    const payload = await ctx.manager.withConnection(config, async (conn) => {
      const { locator, columns } = await resolveRowLocator(
        () => conn.getMetadata().listColumns(body.schema, body.table),
        () => conn.getMetadata().listIndexes(body.schema, body.table),
      );
      if (columns.length === 0) throw notFound('数据表', `${body.schema}.${body.table}`);

      const known = new Set(columns.map((c) => c.name));
      const selected = buildColumnList(conn, columns.map((c) => c.name), known).join(', ');
      const from = quoteFor(conn, body.schema || null, body.table);

      // 排序：默认按定位符列排（结果稳定，翻页不会串行）；
      // 用户点列头时按点的那一列排，第二排序键仍是定位符，保证稳定。
      const orderColumns: string[] = [];
      const requested = body.orderBy ?? null;
      if (requested) {
        if (!known.has(requested)) {
          throw new PeanutError('VALIDATION_FAILED', `无法按不存在的列排序: ${requested}`);
        }
        orderColumns.push(requested);
      } else if (locator.kind !== 'none') {
        orderColumns.push(...locator.columns);
      }
      if (orderColumns.length === 0 && columns[0]) orderColumns.push(columns[0]!.name);

      const dir = body.orderDir === 'desc' ? 'DESC' : 'ASC';
      const orderBy = orderColumns
        .map((name) => `${quoteFor(conn, null, name)} ${dir}`)
        .join(', ');

      const exec = conn.getQueryExecutor();
      // LIMIT/OFFSET 一律走绑定参数，不拼数字进 SQL ——
      // `QueryOptions.params` 就是为此存在的（SQLite/MySQL 用 ?，PostgreSQL 系用 $1/$2）。
      const params: CellValue[] = [pageSize, offset];
      const sql =
        `SELECT ${selected} FROM ${from} ORDER BY ${orderBy} ` +
        `LIMIT ${placeholderFor(conn, 0)} OFFSET ${placeholderFor(conn, 1)}`;
      const result = await exec.execute(sql, { maxRows: pageSize, params });

      // 行数统计：扫描量封顶，数到上限就如实说"未知"
      let total: number | null = null;
      try {
        const counted = await exec.execute(
          `SELECT COUNT(*) AS n FROM (SELECT 1 AS x FROM ${from} LIMIT ${COUNT_CAP + 1}) AS ps_count`,
        );
        const raw = counted.rows[0]?.[0];
        const n = typeof raw === 'number' ? raw : Number(raw);
        total = Number.isFinite(n) && n <= COUNT_CAP ? n : null;
      } catch {
        // 统计失败（权限、视图、方言差异）不该让整页数据打不开
        total = null;
      }

      let readOnlyReason: 'no_primary_key' | 'no_permission' | 'connection_readonly' | null = null;
      if (!auth.permissions.includes('query.write')) readOnlyReason = 'no_permission';
      else if (dto?.isReadOnly) readOnlyReason = 'connection_readonly';
      else if (locator.kind === 'none') readOnlyReason = 'no_primary_key';

      return {
        columns,
        rows: result.rows,
        total,
        page,
        pageSize,
        locator,
        editable: readOnlyReason === null,
        readOnlyReason,
      };
    });

    return reply.send(payload);
  });

  app.post('/data/table/insert', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(insertSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'insert', table: body.table });

    const entries = Object.entries(body.values).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      throw new PeanutError('VALIDATION_FAILED', '新增记录至少要填一列');
    }

    const inserted = await ctx.manager.withConnection(config, async (conn) => {
      const columns = await conn.getMetadata().listColumns(body.schema, body.table);
      if (columns.length === 0) throw notFound('数据表', `${body.schema}.${body.table}`);
      const known = new Set(columns.map((c) => c.name));
      const names = entries.map(([name]) => name);
      const quoted = buildColumnList(conn, names, known);

      // 非空且无默认值的列必须给值，否则数据库会报一个对用户毫无帮助的错。
      // 这里提前拦下来，指名是哪一列。
      const missing = columns.filter(
        (c) =>
          !c.nullable &&
          c.defaultValue === null &&
          !names.includes(c.name) &&
          // 自增/序列列不填也合法，但它们通常带 default；这里再排除主键单列自增的常见写法
          !c.isPrimaryKey,
      );
      if (missing.length > 0) {
        throw new PeanutError('VALIDATION_FAILED', `以下列不允许为空，必须填写：${missing.map((c) => c.name).join(', ')}`, {
          columns: missing.map((c) => c.name),
        });
      }

      const placeholders = quoted.map((_, i) => placeholderFor(conn, i)).join(', ');
      const sql = `INSERT INTO ${quoteFor(conn, body.schema || null, body.table)} (${quoted.join(', ')}) VALUES (${placeholders})`;
      await conn.getQueryExecutor().executeUpdate(sql, entries.map(([, v]) => v));
      return 1;
    });

    ctx.pdb.audit.append({
      ...actorOf(req),
      action: 'write',
      resourceType: 'table_row',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      status: 'success',
      detail: { operation: 'insert', schema: body.schema, table: body.table, columns: Object.keys(body.values) },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, inserted });
  });

  app.post('/data/table/update', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(updateSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'update', table: body.table });

    const changes = Object.entries(body.changes).filter(([, v]) => v !== undefined);
    if (changes.length === 0) throw new PeanutError('VALIDATION_FAILED', '没有需要修改的列');

    const updated = await ctx.manager.withConnection(config, async (conn) => {
      const columns = await conn.getMetadata().listColumns(body.schema, body.table);
      const { locator } = await resolveRowLocator(
        async () => columns,
        () => conn.getMetadata().listIndexes(body.schema, body.table),
      );
      assertKeyMatchesLocator(locator, body.key);
      const known = new Set(columns.map((c) => c.name));

      // 非空列不允许被改成 NULL（数据库也会拒，但报错信息远不如这里清楚）
      for (const [name, value] of changes) {
        if (!known.has(name)) throw new PeanutError('VALIDATION_FAILED', `数据表中没有这一列: ${name}`);
        if (value === null) {
          const column = columns.find((c) => c.name === name);
          if (column && !column.nullable) {
            throw new PeanutError('VALIDATION_FAILED', `列 ${name} 不允许为空`);
          }
        }
      }

      const quotedChanges = changes.map(([name, value]) => [name, value] as [string, CellValue]);
      // 用引用后的名字校验：buildUpdate 内部会再引用一次，这里只做白名单检查
      buildColumnList(conn, [...changes.map(([n]) => n), ...locator.columns], known);
      const { sql, params } = buildUpdate(
        conn,
        body.schema,
        body.table,
        quotedChanges,
        orderedKey(locator, body.key),
      );
      const affected = await conn.getQueryExecutor().executeUpdate(sql, params);
      // 定位符本应保证至多命中一行。命中 0 行说明记录已被别人删除；
      // 命中多行说明定位符判定出了问题 —— 两种情况都要让调用方知道，
      // 而不是回一个"成功"把问题掩盖过去。
      if (affected === 0) {
        throw new PeanutError('NOT_FOUND', '这一行已经不存在了（可能被其他人删除），请刷新后重试');
      }
      if (affected > 1) {
        throw new PeanutError(
          'CONFLICT',
          `定位条件命中了 ${affected} 行，已中止以避免批量误改；请刷新后重试`,
          { affected },
        );
      }
      return affected;
    });

    ctx.pdb.audit.append({
      ...actorOf(req),
      action: 'write',
      resourceType: 'table_row',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      status: 'success',
      detail: {
        operation: 'update',
        schema: body.schema,
        table: body.table,
        columns: changes.map(([n]) => n),
        keyColumns: Object.keys(body.key),
      },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, updated });
  });

  app.post('/data/table/delete', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(deleteSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'delete', table: body.table });

    const deleted = await ctx.manager.withConnection(config, async (conn) => {
      const columns = await conn.getMetadata().listColumns(body.schema, body.table);
      const { locator } = await resolveRowLocator(
        async () => columns,
        () => conn.getMetadata().listIndexes(body.schema, body.table),
      );
      const known = new Set(columns.map((c) => c.name));
      const exec = conn.getQueryExecutor();

      let count = 0;
      for (const key of body.keys) {
        assertKeyMatchesLocator(locator, key);
        buildColumnList(conn, locator.columns, known);
        const { sql, params } = buildDelete(conn, body.schema, body.table, orderedKey(locator, key));
        const affected = await exec.executeUpdate(sql, params);
        // 删除命中 0 行不是错误（别人可能已经删掉了），但命中多行必须中止：
        // 那意味着定位符没有起到"定位一行"的作用。
        if (affected > 1) {
          throw new PeanutError(
            'CONFLICT',
            `定位条件命中了 ${affected} 行，已中止以避免批量误删；请刷新后重试`,
            { affected },
          );
        }
        count += affected;
      }
      return count;
    });

    ctx.pdb.audit.append({
      ...actorOf(req),
      action: 'write',
      resourceType: 'table_row',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      status: 'success',
      detail: {
        operation: 'delete',
        schema: body.schema,
        table: body.table,
        requested: body.keys.length,
        deleted,
      },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, deleted });
  });
}
