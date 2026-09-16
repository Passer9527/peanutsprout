/**
 * 花生苗数据库管理工具 - 数据导出路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 两个出口，都是"把一条查询的结果搬到别处去"：
 *
 *   · `POST /data/export/xlsx`          → 导出成 Excel（.xlsx）下载
 *   · `POST /data/export/to-connection` → 写进**另一个数据库连接**的表里
 *
 * 三处刻意的约束：
 *
 *  1. **只接受只读 SQL**。导出是"读出来搬走"，不是"顺便改一下源库"；
 *     源端 SQL 一律先过 `isWriteStatement`，写语句直接拒绝。
 *  2. **一次只导一条语句**。多条语句会产生多个结果集，而 Excel 的一个工作表
 *     只能对应一个结果集；与其悄悄只取第一条，不如明确拒绝。
 *  3. **目标端是写操作，走与 SQL 执行完全相同的写闸门**
 *     （`assertCanWrite`：权限码 + 只读连接 + 资源写授权 + 生产库标识）。
 *     否则"导出到别的库"就成了绕过写保护的旁路。
 */

import { z } from 'zod';
import {
  PeanutError,
  getDbTypeInfo,
  isWriteStatement,
  notFound,
  splitSqlStatements,
  type ColumnInfo,
  type DriverConnection,
  type TypeMapper,
} from '@peanutsprout/core';
import { assertCanWrite, assertConnectionVisible } from '@peanutsprout/auth';
import { buildInsert, quoteFor } from '@peanutsprout/migration';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth } from '../http.js';
import { buildXlsx } from '../lib/xlsx.js';

/** 单次导出允许拉取的最大行数硬上限。再大也不会一次性全灌进内存。 */
const EXPORT_MAX_ROWS_CEILING = 200_000;
/** 默认导出行数。用设置项 `query.max_rows` 兜底，但不超过上面的硬上限。 */
const EXPORT_MAX_ROWS_DEFAULT = 50_000;

/** 解析并夹取导出行数：请求值只能让上限更小，不能让上限失效。 */
function resolveMaxRows(requested: number | undefined, setting: number): number {
  const cap = Math.max(1, Math.min(setting, EXPORT_MAX_ROWS_CEILING));
  if (requested === undefined) return cap;
  return Math.max(1, Math.min(requested, cap));
}

/**
 * 校验待导出的 SQL：必须是一条只读语句。
 *
 * 返回去掉尾部分号的语句，供执行时使用。
 */
function assertExportableSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new PeanutError('VALIDATION_FAILED', 'SQL 不能为空');
  const statements = splitSqlStatements(trimmed);
  if (statements.length > 1) {
    throw new PeanutError('VALIDATION_FAILED', '一次只能导出一条语句的结果', {
      statementCount: statements.length,
      hint: '请把多条语句分开导出；Excel 的一个工作表只能对应一个结果集',
    });
  }
  if (isWriteStatement(trimmed)) {
    throw new PeanutError('VALIDATION_FAILED', '只能导出只读查询的结果', {
      hint: '导出是"把查询结果搬走"，不修改源库；请改用 SELECT 类语句',
    });
  }
  return trimmed;
}

/** 文件名里不能出现路径分隔符与控制字符，这里统一收敛成一个安全字符集。 */
function safeFileStem(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'export';
}

export async function registerDataExportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const xlsxSchema = z.object({
    connectionId: z.number().int().positive(),
    sql: z.string().min(1).max(100_000),
    /** 工作表名；不传就用连接名 */
    sheetName: z.string().max(120).optional(),
    /** 文件名前缀（不含扩展名） */
    fileName: z.string().max(120).optional(),
    maxRows: z.number().int().min(1).max(EXPORT_MAX_ROWS_CEILING).optional(),
  });

  /**
   * 导出查询结果为 Excel。
   *
   * 权限用 `query.read`：这是一次只读查询，产物是一个文件，
   * 与"能看到这张表就能导出这张表"的语义一致。审计里记 `export`。
   */
  app.post('/data/export/xlsx', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(xlsxSchema, req.body);
    const dto = ctx.pdb.connections.get(body.connectionId);
    if (!dto) throw notFound('连接', body.connectionId);
    assertConnectionVisible(auth, body.connectionId);

    const sql = assertExportableSql(body.sql);
    const config = ctx.pdb.connections.getConfig(body.connectionId);
    if (!config) throw notFound('连接', body.connectionId);

    const maxRows = resolveMaxRows(
      body.maxRows,
      ctx.pdb.settings.getNumber('query.max_rows', EXPORT_MAX_ROWS_DEFAULT),
    );
    const startedAt = Date.now();
    const result = await ctx.manager.withConnection(config, (conn) =>
      conn.getQueryExecutor().execute(sql, { maxRows }),
    );

    // 结果集 → 工作表。列宽按表头长度给一个够用的值，纯粹为了好看。
    const sheet = {
      name: body.sheetName ?? dto.name,
      columns: result.columns.map((column) => ({
        name: column.name,
        width: Math.min(40, Math.max(10, column.name.length + 4)),
      })),
      rows: result.rows.map((row) => row.map((cell) => cell)),
    };
    const buffer = buildXlsx([sheet]);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stem = safeFileStem(body.fileName ?? dto.name);
    const filename = `${stem}-${stamp}.xlsx`;
    // HTTP 头只能是 ASCII（Node 会直接抛 ERR_INVALID_CHAR），而连接名几乎一定是中文。
    // 标准做法：给一个 ASCII 回退名 + `filename*=UTF-8''<百分号编码>` 供现代客户端取真名。
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'export',
      resourceType: 'query_result',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      sqlText: sql.slice(0, 2000),
      status: 'success',
      durationMs: Date.now() - startedAt,
      detail: {
        format: 'xlsx',
        rows: result.rows.length,
        columns: result.columns.length,
        // 截断必须写进审计：否则事后无法区分"表里就这么多行"和"导出时被截断了"
        truncated: result.truncated,
        maxRows,
        fileName: filename,
      },
      ipAddress: clientIp(req),
    });

    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', disposition)
      // 截断状态也让响应头能看出来，便于脚本化调用时判断
      .header('x-export-truncated', result.truncated ? 'true' : 'false')
      .header('access-control-expose-headers', 'content-disposition,x-export-truncated')
      .send(buffer);
  });

  const toConnectionSchema = z.object({
    sourceConnectionId: z.number().int().positive(),
    sql: z.string().min(1).max(100_000),
    targetConnectionId: z.number().int().positive(),
    targetSchema: z.string().max(128).nullish(),
    targetTable: z.string().min(1).max(128),
    /**
     * create：目标表必须不存在，按结果集列新建
     * append：目标表必须已存在，只追加
     * replace：目标表存在则先删掉再建（**会丢数据**，界面上要二次确认）
     */
    mode: z.enum(['create', 'append', 'replace']).default('create'),
    maxRows: z.number().int().min(1).max(EXPORT_MAX_ROWS_CEILING).optional(),
    batchSize: z.number().int().min(1).max(10_000).optional(),
  });

  /**
   * 把查询结果写进另一个数据库连接的表。
   *
   * 授权模型：源端要求 `query.read`（本路由的 preHandler）+ 连接可见，
   * 目标端额外走 `assertCanWrite` —— 与用户直接在目标库执行写语句是同一道闸门。
   */
  app.post('/data/export/to-connection', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(toConnectionSchema, req.body);

    const sourceDto = ctx.pdb.connections.get(body.sourceConnectionId);
    if (!sourceDto) throw notFound('连接', body.sourceConnectionId);
    const targetDto = ctx.pdb.connections.get(body.targetConnectionId);
    if (!targetDto) throw notFound('连接', body.targetConnectionId);
    assertConnectionVisible(auth, sourceDto.id);
    assertConnectionVisible(auth, targetDto.id);
    // 目标库是写入方：沿用与 /query/execute 完全相同的写闸门
    assertCanWrite(auth, targetDto.id, targetDto);

    const sql = assertExportableSql(body.sql);
    const sourceConfig = ctx.pdb.connections.getConfig(body.sourceConnectionId);
    if (!sourceConfig) throw notFound('连接', body.sourceConnectionId);
    const targetConfig = ctx.pdb.connections.getConfig(body.targetConnectionId);
    if (!targetConfig) throw notFound('连接', body.targetConnectionId);
    if (body.sourceConnectionId === body.targetConnectionId) {
      // 同库导出没有意义，还容易把源表自己覆盖掉
      throw new PeanutError('VALIDATION_FAILED', '源连接与目标连接不能是同一个');
    }

    const maxRows = resolveMaxRows(
      body.maxRows,
      ctx.pdb.settings.getNumber('query.max_rows', EXPORT_MAX_ROWS_DEFAULT),
    );
    const batchSize = body.batchSize ?? 500;
    const targetSchema = body.targetSchema ?? null;
    const startedAt = Date.now();

    const warnings: string[] = [];

    // 源连接的类型映射器要留到目标端建表时用：把结果集里的源库类型
    // 换算成目标库类型（与迁移引擎同一套逻辑，避免出现目标库不认识的原生类型）。
    let sourceMapper: ReturnType<DriverConnection['getTypeMapper']> | null = null;
    const result = await ctx.manager.withConnection(sourceConfig, async (conn) => {
      sourceMapper = conn.getTypeMapper();
      return conn.getQueryExecutor().execute(sql, { maxRows });
    });
    if (result.columns.length === 0) {
      throw new PeanutError('VALIDATION_FAILED', '该语句没有返回任何列，无法据此建表');
    }
    if (result.truncated) {
      warnings.push(`结果集超过 ${maxRows} 行上限，只导出了前 ${result.rows.length} 行`);
    }

    // 目标 schema：不传时按目标库的"默认 schema"取，空串会让部分库报错
    const effectiveSchema = defaultSchemaOf(targetDto.dbType, targetSchema);

    const written = await ctx.manager.withConnection(targetConfig, async (target) => {
      const meta = target.getMetadata();
      const existing = await meta.listTables(effectiveSchema);
      const existed = existing.some((t) => t.name === body.targetTable);

      if (body.mode === 'create' && existed) {
        throw new PeanutError('CONFLICT', `目标表已存在: ${body.targetTable}`, {
          hint: '改用 append 追加，或 replace 覆盖（replace 会先删表，数据会丢）',
        });
      }
      if (body.mode === 'append' && !existed) {
        throw new PeanutError('NOT_FOUND', `目标表不存在: ${body.targetTable}`, {
          hint: '改用 create 模式按结果集新建表',
        });
      }

      const ddlGen = target.getDdlGenerator();
      if (body.mode !== 'append') {
        if (existed) {
          // replace：先删后建，结构与结果集对齐
          await target.getQueryExecutor().execute(ddlGen.dropTable(effectiveSchema, body.targetTable));
        }
        const planned = buildExportColumns({
          resultColumns: result.columns,
          sourceMapper,
          targetDbType: targetDto.dbType,
          schema: effectiveSchema,
          table: body.targetTable,
        });
        const columns = planned.columns;
        warnings.push(...planned.warnings);
        const ddl = ddlGen.createTable(effectiveSchema, body.targetTable, columns);
        for (const statement of splitSqlStatements(ddl)) {
          await target.getQueryExecutor().execute(statement);
        }
      }

      const exec = target.getQueryExecutor();
      const insertSql = buildInsert(
        target,
        effectiveSchema,
        body.targetTable,
        result.columns.map((c) => c.name),
      );
      let count = 0;
      for (let offset = 0; offset < result.rows.length; offset += batchSize) {
        const batch = result.rows.slice(offset, offset + batchSize);
        for (const row of batch) {
          // 结果集可能比列数短（驱动补齐差异），这里统一补齐成 null，避免绑定参数个数不符
          const params = result.columns.map((_, i) => row[i] ?? null);
          await exec.executeUpdate(insertSql, params);
          count += 1;
        }
      }
      return count;
    });

    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'export',
      resourceType: 'connection',
      resourceId: String(body.targetConnectionId),
      connectionId: body.sourceConnectionId,
      sqlText: sql.slice(0, 2000),
      status: 'success',
      durationMs: Date.now() - startedAt,
      detail: {
        format: 'connection',
        targetConnectionId: body.targetConnectionId,
        targetTable: body.targetTable,
        mode: body.mode,
        rows: written,
        truncated: result.truncated,
      },
      ipAddress: clientIp(req),
    });

    return reply.send({
      ok: true,
      rows: written,
      targetTable: body.targetTable,
      mode: body.mode,
      truncated: result.truncated,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

/**
 * 把"结果集的列"换算成"目标库建表用的列"。
 *
 * 抽成纯函数是为了能直接单测：真实跑一遍跨库导出需要连上目标库，
 * 而这段逻辑（类型换算 + 有损映射告警）恰恰是最容易出错的部分。
 */
export function buildExportColumns(input: {
  resultColumns: ReadonlyArray<{ name: string; dataType: string }>;
  sourceMapper: TypeMapper | null;
  targetDbType: string;
  schema: string;
  table: string;
}): { columns: ColumnInfo[]; warnings: string[] } {
  const warnings: string[] = [];
  const columns: ColumnInfo[] = input.resultColumns.map((column, index) => {
    // 用**源库的类型映射器**换算成目标库类型；拿不到就原样透传
    // （建表可能失败，但绝不静默改写成别的类型）
    const mapped = input.sourceMapper
      ? input.sourceMapper.mapType(column.dataType, input.targetDbType as never)
      : null;
    // 有损映射必须说出来：例如把大整数映射成 32 位整数会**悄悄截断高位**，
    // 用户事后对不上数才来查就晚了。与迁移引擎用同一套 lossy/note 语义。
    if (mapped?.lossy) {
      warnings.push(
        `列 ${column.name}：${column.dataType} → ${mapped.type}${mapped.note ? `（${mapped.note}）` : ''}，可能存在精度或语义损失`,
      );
    }
    return {
      schema: input.schema,
      table: input.table,
      name: column.name,
      dataType: mapped ? mapped.type : column.dataType,
      nullable: true,
      defaultValue: null,
      comment: null,
      isPrimaryKey: false,
      ordinal: index,
    };
  });
  return { columns, warnings };
}

/**
 * 目标库的"默认 schema"。
 *
 * 不能想当然地传空串：SQLite 的默认 schema 是 `main`，PostgreSQL 是 `public`，
 * SQL Server 是 `dbo` —— 传空串会在标识符白名单校验处直接报 `非法标识符: ""`。
 * 这里与迁移引擎用同一份元数据（`DB_TYPES[].defaultSchema`），不另立一套规则。
 */
function defaultSchemaOf(dbType: string, requested: string | null): string {
  if (requested) return requested;
  return getDbTypeInfo(dbType).defaultSchema;
}
