/**
 * 花生苗数据库管理工具 - 可视化建库建表路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 让用户不写 SQL 就能建 Schema / 建表 / 删表。三条硬规矩：
 *
 *  1. **预览与执行彻底分开。** `POST /ddl/preview` 只返回语句文本，
 *     一个字节都不发给数据库；`POST /ddl/execute` 才真正执行。
 *     界面必须先把预览摆给用户看，再让用户确认。
 *  2. **执行必须二次确认 + 过写闸门。** 与 SQL 开发页同一套 `assertCanWrite`
 *     （权限、连接只读、资源级授权），并要求 `confirm: true`；
 *     被拒绝的尝试同样落审计。
 *  3. **默认值只能白名单。** DDL 不支持绑定参数，`DEFAULT` 后面的内容
 *     必然是被拼进 SQL 文本的；驱动层的 DdlGenerator 也是原样输出。
 *     所以这里用 `isSafeDefaultExpression` 把它限制在字面量与少数标准函数，
 *     挡住在默认值里塞第二条语句的写法。这是一个**真实存在的边界**，
 *     不是"已经彻底防住了"——注释里写明。
 */

import { z } from 'zod';
import { PeanutError, getDbTypeInfo, normalizeError, notFound, type ColumnInfo, type IndexInfo } from '@peanutsprout/core';
import { assertCanWrite, assertConnectionVisible } from '@peanutsprout/auth';
import { quoteIdent, quoteIdentBacktick } from '@peanutsprout/drivers';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth, userAgent } from '../http.js';
import {
  columnTypesFor,
  isSafeDefaultExpression,
  schemaKeywordFor,
  supportsIfNotExists,
} from '../lib/column-types.js';

const identifierSchema = z
  .string()
  .min(1, '名称不能为空')
  .max(64, '名称过长')
  .regex(/^[A-Za-z_][A-Za-z0-9_$]*$/, '名称只能包含字母、数字、下划线和 $，且不能以数字开头');

const columnSchema = z.object({
  name: identifierSchema,
  dataType: z.string().min(1, '请选择类型').max(64),
  /** 长度 / 精度。用字符串收，再自己拆，避免 `decimal(10,2)` 这种两位参数被压成一个数 */
  length: z.union([z.number().int().min(1).max(65535), z.string().max(16)]).nullish(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
  defaultValue: z.string().max(200).nullish(),
  comment: z.string().max(500).nullish(),
});

const indexSchema = z.object({
  name: identifierSchema,
  columns: z.array(z.string().min(1).max(64)).min(1, '索引至少要有一列').max(16),
  unique: z.boolean(),
});

const tableSpecSchema = z.object({
  connectionId: z.number().int().positive('请选择连接'),
  schema: z.string().max(128).default(''),
  table: identifierSchema,
  columns: z.array(columnSchema).min(1, '至少需要一列').max(200),
  indexes: z.array(indexSchema).max(50).default([]),
  ifNotExists: z.boolean().optional(),
});

const executeSchema = tableSpecSchema.extend({ confirm: z.boolean().optional() });

const createSchemaSchema = z.object({
  connectionId: z.number().int().positive('请选择连接'),
  name: identifierSchema,
  confirm: z.boolean().optional(),
});

const dropTableSchema = z.object({
  connectionId: z.number().int().positive('请选择连接'),
  schema: z.string().max(128).default(''),
  table: identifierSchema,
  confirm: z.boolean().optional(),
});

/* ------------------------------------------------------------------ 纯逻辑（可单测） */

/** 按方言引用标识符：MySQL 系用反引号，其余用双引号。两者都带白名单校验。 */
export function quoteNameFor(dbType: string, name: string): string {
  switch (dbType) {
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'oceanbase':
      return quoteIdentBacktick(name);
    default:
      return quoteIdent(name);
  }
}

/**
 * 把界面来的列定义转成驱动 `DdlGenerator` 需要的 `ColumnInfo`。
 *
 * 两处归一化值得说明：
 *  · **主键列强制非空** —— 界面也会这么显示，但界面可以被绕过，
 *    这里再钉一次，避免出现"主键可为空"这种数据库自己都不接受的定义；
 *  · `length` 拼到类型名后面（`varchar` + `64` → `varchar(64)`），
 *    因为驱动的 `ColumnInfo.dataType` 只有一个字段，没有单独的精度位。
 */
export function toColumnInfos(
  schema: string,
  table: string,
  columns: Array<{
    name: string;
    dataType: string;
    length?: number | string | null;
    nullable: boolean;
    primaryKey: boolean;
    defaultValue?: string | null;
    comment?: string | null;
  }>,
): ColumnInfo[] {
  return columns.map((column, ordinal) => {
    const raw = column.length === null || column.length === undefined ? '' : String(column.length).trim();
    const dataType = raw.length > 0 ? `${column.dataType}(${raw})` : column.dataType;
    return {
      schema,
      table,
      name: column.name,
      dataType,
      // 主键必须非空：这是主键的定义，不是用户的偏好
      nullable: column.primaryKey ? false : column.nullable,
      defaultValue: column.defaultValue?.trim() ? column.defaultValue.trim() : null,
      comment: column.comment?.trim() ? column.comment.trim() : null,
      isPrimaryKey: column.primaryKey,
      ordinal,
    };
  });
}

export function toIndexInfos(
  schema: string,
  table: string,
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>,
): IndexInfo[] {
  return indexes.map((index) => ({
    schema,
    table,
    name: index.name,
    columns: index.columns,
    unique: index.unique,
    primary: false,
  }));
}

/**
 * 校验一次建表请求，返回错误描述列表（空数组 = 通过）。
 *
 * 返回描述而不是直接抛异常，是为了能单测每一条规则；
 * 路由层拿到非空列表后抛 `VALIDATION_FAILED` 并把第一条的消息带上。
 */
export function validateTableSpec(spec: {
  table: string;
  columns: Array<{ name: string; dataType: string; defaultValue?: string | null; length?: number | string | null }>;
  indexes: Array<{ name: string; columns: string[] }>;
}): Array<{ code: string; message: string }> {
  const errors: Array<{ code: string; message: string }> = [];
  if (spec.columns.length === 0) {
    errors.push({ code: 'NO_COLUMNS', message: '至少需要一列' });
  }
  const seen = new Set<string>();
  for (const column of spec.columns) {
    const key = column.name.toLowerCase();
    if (seen.has(key)) {
      errors.push({ code: 'DUPLICATE_COLUMN', message: `列名重复：${column.name}` });
    }
    seen.add(key);
    if (!isSafeDefaultExpression(column.defaultValue ?? '')) {
      errors.push({
        code: 'UNSAFE_DEFAULT',
        message:
          `列 ${column.name} 的默认值不被允许：只接受数字、单引号字符串、true/false、NULL ` +
          '或 CURRENT_TIMESTAMP 这类标准值（DDL 无法使用绑定参数，因此必须白名单）',
      });
    }
  }
  const columnNames = new Set(spec.columns.map((c) => c.name));
  const indexNames = new Set<string>();
  for (const index of spec.indexes) {
    if (indexNames.has(index.name.toLowerCase())) {
      errors.push({ code: 'DUPLICATE_INDEX', message: `索引名重复：${index.name}` });
    }
    indexNames.add(index.name.toLowerCase());
    if (index.columns.length === 0) {
      errors.push({ code: 'INDEX_NO_COLUMNS', message: `索引 ${index.name} 没有选择列` });
    }
    for (const name of index.columns) {
      if (!columnNames.has(name)) {
        errors.push({ code: 'INDEX_UNKNOWN_COLUMN', message: `索引 ${index.name} 引用了不存在的列：${name}` });
      }
    }
  }
  if (spec.table.length === 0) {
    errors.push({ code: 'NO_TABLE_NAME', message: '请填写表名' });
  }
  return errors;
}

/**
 * 生成建表要执行的语句列表（**不执行**）。
 *
 * 刻意拆成「一条 CREATE TABLE + 每条索引一条 CREATE INDEX」：
 * 驱动自带的 `createTable(schema, table, columns, indexes)` 会把它们拼成
 * 一个多行字符串，再按分号切回来是脆的（默认值里的分号就会切错）。
 * 这里自己逐条调 `createIndex`，数组元素与"一条可执行语句"一一对应。
 *
 * `IF NOT EXISTS` 是**文本改写**：驱动接口没有这个开关。只对支持该语法的
 * 方言改写，遇到不支持的方言直接报错，而不是生成一句语法错的 SQL 让用户去撞。
 *
 * 注意 `IF NOT EXISTS` **只作用于 CREATE TABLE**（界面文案也写的是"表已存在时
 * 不报错"）。索引语句不加这个子句，因为 MySQL 不支持
 * `CREATE INDEX IF NOT EXISTS` —— 只在部分方言上做幂等，会让"重跑一次"的
 * 结果取决于用户用哪个库，比不做更难预期。所以：表可以重复建不报错，
 * 同名索引再次创建会如实报错。
 */
export function buildCreateTableStatements(
  ddl: {
    createTable: (schema: string, table: string, columns: ColumnInfo[], indexes?: IndexInfo[]) => string;
    createIndex: (schema: string, table: string, index: IndexInfo) => string;
  },
  dbType: string,
  schema: string,
  table: string,
  columns: ColumnInfo[],
  indexes: IndexInfo[],
  ifNotExists: boolean,
): string[] {
  const statements: string[] = [];
  let create = ddl.createTable(schema, table, columns);
  if (ifNotExists) {
    if (!supportsIfNotExists(dbType)) {
      throw new PeanutError('VALIDATION_FAILED', `${dbType} 不支持 CREATE TABLE IF NOT EXISTS，请去掉该选项`, {
        dbType,
      });
    }
    const rewritten = create.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
    if (rewritten === create) {
      // 改写没生效说明驱动生成的语句形态变了：如实报错，别默默忽略用户的勾选
      throw new PeanutError('INTERNAL', '无法在该方言的建表语句里插入 IF NOT EXISTS，已中止而不是忽略该选项');
    }
    create = rewritten;
  }
  statements.push(create);
  for (const index of indexes) {
    statements.push(ddl.createIndex(schema, table, index));
  }
  return statements;
}

/** 生成 `CREATE SCHEMA` / `CREATE DATABASE` 语句；不支持的方言直接报错。 */
export function buildCreateSchemaStatement(dbType: string, name: string, label: string): string {
  const keyword = schemaKeywordFor(dbType);
  if (keyword === null) {
    throw new PeanutError(
      'VALIDATION_FAILED',
      `${label} 不支持用 SQL 创建 Schema 或数据库，请在连接管理里新建库`,
      { dbType },
    );
  }
  return `CREATE ${keyword} ${quoteNameFor(dbType, name)};`;
}

/* ------------------------------------------------------------------ 路由 */

export async function registerDdlRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const resolve = (req: FastifyRequest, connectionId: number) => {
    const auth = authOf(req);
    const dto = ctx.pdb.connections.get(connectionId);
    if (!dto) throw notFound('连接', connectionId);
    assertConnectionVisible(auth, connectionId);
    const config = ctx.pdb.connections.getConfig(connectionId);
    if (!config) throw notFound('连接', connectionId);
    return { auth, dto, config };
  };

  /** 写闸门 + 被拒绝时落审计，与表数据编辑器同一套。 */
  const ensureWritable = (
    req: FastifyRequest,
    connectionId: number,
    dto: unknown,
    detail: Record<string, unknown>,
  ): void => {
    const auth = authOf(req);
    try {
      assertCanWrite(auth, connectionId, dto as never);
    } catch (error) {
      const err = normalizeError(error);
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'ddl',
        resourceType: 'connection',
        resourceId: String(connectionId),
        connectionId,
        status: 'denied',
        errorMessage: 'DDL 操作被拒绝',
        detail: { ...detail, gate: err.code },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      throw error;
    }
  };

  /** 需要二次确认的 DDL：未带 confirm 时返回 428，与 SQL 开发页语义一致。 */
  const requireConfirm = (confirm: boolean | undefined, what: string): void => {
    if (confirm === true) return;
    throw new PeanutError('CONFIRMATION_REQUIRED', `${what}会真实修改数据库结构，请确认后携带 confirm=true 重新提交`);
  };

  app.get('/ddl/column-types/:connectionId', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const params = parse(z.object({ connectionId: z.coerce.number().int().positive() }), req.params);
    const { dto } = resolve(req, params.connectionId);
    return reply.send({ dbType: dto.dbType, types: columnTypesFor(dto.dbType) });
  });

  app.get('/ddl/schema-support/:connectionId', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const params = parse(z.object({ connectionId: z.coerce.number().int().positive() }), req.params);
    const { dto } = resolve(req, params.connectionId);
    const keyword = schemaKeywordFor(dto.dbType);
    return reply.send({ dbType: dto.dbType, supported: keyword !== null, keyword });
  });

  /**
   * 生成建表语句 —— **只生成，不执行**。
   *
   * 这里只要求 `conn.read`：预览不碰数据库，只做字符串拼装。
   * "能不能执行"由 `/ddl/execute` 自己把关，不靠预览接口先挡一道来假装安全。
   */
  app.post('/ddl/preview', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const body = parse(tableSpecSchema, req.body);
    const { dto } = resolve(req, body.connectionId);

    const errors = validateTableSpec(body);
    if (errors.length > 0) {
      throw new PeanutError('VALIDATION_FAILED', errors[0]!.message, { errors });
    }
    if (body.ifNotExists && !supportsIfNotExists(dto.dbType)) {
      throw new PeanutError('VALIDATION_FAILED', `${getDbTypeInfo(dto.dbType).label} 不支持 CREATE TABLE IF NOT EXISTS`, {
        dbType: dto.dbType,
      });
    }

    const columns = toColumnInfos(body.schema, body.table, body.columns);
    const indexes = toIndexInfos(body.schema, body.table, body.indexes);

    // 预览需要驱动来生成 DDL，因此确实要建一次连接；但只调 DdlGenerator，
    // 不调 execute —— `withConnection` 的回调返回值就是这里生成的语句。
    const statements = await ctx.manager.withConnection(
      ctx.pdb.connections.getConfig(body.connectionId)!,
      async (conn) =>
        buildCreateTableStatements(
          conn.getDdlGenerator(),
          conn.config.dbType,
          body.schema,
          body.table,
          columns,
          indexes,
          body.ifNotExists === true,
        ),
    );
    return reply.send({ statements });
  });

  app.post('/ddl/execute', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(executeSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'create_table', table: body.table });
    requireConfirm(body.confirm, '建表');

    const errors = validateTableSpec(body);
    if (errors.length > 0) {
      throw new PeanutError('VALIDATION_FAILED', errors[0]!.message, { errors });
    }
    const columns = toColumnInfos(body.schema, body.table, body.columns);
    const indexes = toIndexInfos(body.schema, body.table, body.indexes);

    const { statements, executed } = await ctx.manager.withConnection(config, async (conn) => {
      const list = buildCreateTableStatements(
        conn.getDdlGenerator(),
        conn.config.dbType,
        body.schema,
        body.table,
        columns,
        indexes,
        body.ifNotExists === true,
      );
      const exec = conn.getQueryExecutor();
      let done = 0;
      for (const sql of list) {
        await exec.executeUpdate(sql);
        done += 1;
      }
      return { statements: list, executed: done };
    });

    ctx.pdb.audit.append({
      userId: authOf(req).user.id,
      username: authOf(req).user.username,
      action: 'ddl',
      resourceType: 'connection',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      sqlText: statements.join('\n').slice(0, 4000),
      status: 'success',
      detail: {
        operation: 'create_table',
        schema: body.schema,
        table: body.table,
        columns: columns.length,
        indexes: indexes.length,
        ifNotExists: body.ifNotExists === true,
      },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, statements, executed });
  });

  app.post('/ddl/create-schema', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(createSchemaSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'create_schema', name: body.name });
    requireConfirm(body.confirm, '创建 Schema / 数据库');

    const statement = buildCreateSchemaStatement(
      dto.dbType,
      body.name,
      getDbTypeInfo(dto.dbType).label,
    );
    await ctx.manager.withConnection(config, async (conn) => {
      await conn.getQueryExecutor().executeUpdate(statement);
    });

    ctx.pdb.audit.append({
      userId: authOf(req).user.id,
      username: authOf(req).user.username,
      action: 'ddl',
      resourceType: 'connection',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      sqlText: statement,
      status: 'success',
      detail: { operation: 'create_schema', name: body.name, dbType: dto.dbType },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, statement });
  });

  app.post('/ddl/drop-table', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const body = parse(dropTableSchema, req.body);
    const { dto, config } = resolve(req, body.connectionId);
    ensureWritable(req, body.connectionId, dto, { operation: 'drop_table', table: body.table });
    requireConfirm(body.confirm, '删除表');

    const statement = await ctx.manager.withConnection(config, async (conn) => {
      // 删之前确认表真的存在：让用户拿到"表不存在"而不是数据库的方言化报错
      const columns = await conn.getMetadata().listColumns(body.schema, body.table);
      if (columns.length === 0) throw notFound('数据表', `${body.schema}.${body.table}`);
      const sql = conn.getDdlGenerator().dropTable(body.schema, body.table);
      await conn.getQueryExecutor().executeUpdate(sql);
      return sql;
    });

    ctx.pdb.audit.append({
      userId: authOf(req).user.id,
      username: authOf(req).user.username,
      action: 'ddl',
      resourceType: 'connection',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      sqlText: statement,
      status: 'success',
      detail: { operation: 'drop_table', schema: body.schema, table: body.table },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({ ok: true, statement });
  });
}
