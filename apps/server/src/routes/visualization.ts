/**
 * 花生苗数据库管理工具 - 图表与看板路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 安全要点（PRD 4.4 / 5.2）：
 *  1. 图表数据一律通过 `buildChartSql` 由**结构化配置**生成 SQL，
 *     不接受客户端直接传 SQL —— 字段名走白名单校验，聚合与排序都是枚举；
 *  2. 若图表配置里保存了自定义 query_sql，取数前必须过连接的可见性校验，
 *     并复用与 /query/execute 相同的权限闸门（只读语句才允许）；
 *  3. 看板/图表默认按用户隔离，跨用户访问返回 404 而不是 403，避免 ID 枚举。
 */

import { z } from 'zod';
import { CHART_TYPES, PeanutError, getDbTypeInfo, isWriteStatement, notFound } from '@peanutsprout/core';
import type { ChartConfig, ChartType } from '@peanutsprout/core';
import {
  CHART_FILTER_OPERATORS,
  buildChartSql,
  getChartTypeInfo,
  validateChartConfig,
  type ChartQuoteStyle,
} from '@peanutsprout/visualization';
import { assertConnectionVisible } from '@peanutsprout/auth';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth, serializeCell } from '../http.js';

const chartFieldSchema = z.object({
  column: z.string().min(1).max(128),
  aggregation: z.enum(['none', 'sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'median']),
  alias: z.string().min(1).max(128).optional(),
});

const chartConfigSchema = z.object({
  dimensions: z.array(chartFieldSchema).max(20).default([]),
  metrics: z.array(chartFieldSchema).max(20).default([]),
  filters: z
    .array(
      z.object({
        column: z.string().min(1).max(128),
        operator: z.enum(CHART_FILTER_OPERATORS),
        value: z.unknown(),
      }),
    )
    .max(50)
    .optional(),
  sort: z
    .array(z.object({ column: z.string().min(1).max(128), direction: z.enum(['asc', 'desc']) }))
    .max(10)
    .optional(),
  limit: z.number().int().min(1).max(100_000).nullable().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

const chartCreateSchema = z.object({
  name: z.string().min(1, '请填写图表名称').max(200),
  chartType: z.string().min(1).max(32),
  dashboardId: z.number().int().positive().nullable().optional(),
  connectionId: z.number().int().positive().nullable().optional(),
  dataSource: z.enum(['table', 'view', 'query']).optional(),
  sourceRef: z.string().max(512).nullable().optional(),
  querySql: z.string().max(100_000).nullable().optional(),
  config: chartConfigSchema,
  refreshMode: z.enum(['manual', 'interval', 'websocket']).nullable().optional(),
  refreshSec: z.number().int().min(5).max(86_400).nullable().optional(),
});

const chartUpdateSchema = chartCreateSchema.partial();

const dashboardCreateSchema = z.object({
  name: z.string().min(1, '请填写看板名称').max(200),
  description: z.string().max(2000).nullable().optional(),
  layout: z.record(z.string(), z.unknown()).nullable().optional(),
  isShared: z.boolean().optional(),
});

const dashboardUpdateSchema = dashboardCreateSchema.partial();

const dataQuerySchema = z.object({
  /** 覆盖图表里保存的 limit（实时预览用） */
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
  maxRows: z.coerce.number().int().min(1).max(1_000_000).optional(),
});

/** 校验图表类型合法，并把 zod 的宽松对象收敛成 ChartConfig。 */
function parseChartType(raw: string): ChartType {
  try {
    return getChartTypeInfo(raw as ChartType).type;
  } catch {
    throw new PeanutError('VALIDATION_FAILED', `不支持的图表类型: ${raw}`);
  }
}

function toChartConfig(config: z.infer<typeof chartConfigSchema>): ChartConfig {
  return {
    dimensions: config.dimensions.map((d) => ({
      column: d.column,
      aggregation: d.aggregation,
      ...(d.alias ? { alias: d.alias } : {}),
    })),
    metrics: config.metrics.map((m) => ({
      column: m.column,
      aggregation: m.aggregation,
      ...(m.alias ? { alias: m.alias } : {}),
    })),
    ...(config.filters ? { filters: config.filters } : {}),
    ...(config.sort ? { sort: config.sort } : {}),
    ...(config.limit !== undefined ? { limit: config.limit } : {}),
    ...(config.style ? { style: config.style } : {}),
  };
}

/** 图表/看板的归属校验：不是本人（且非管理员）一律按"不存在"处理。 */
function assertOwned(ownerId: number, userId: number, isAdmin: boolean, what: string, id: number): void {
  if (ownerId !== userId && !isAdmin) throw notFound(what, id);
}

export async function registerVisualizationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = (req: Parameters<typeof authOf>[0]) => authOf(req);
  const isAdmin = (roles: string[]): boolean => roles.includes('admin');

  // ---------- 图表类型清单（前端图例/表单据此渲染） ----------
  app.get('/charts/types', { preHandler: requireAuth(ctx) }, async (_req, reply) => {
    // 与前端共用 core 里的同一份定义，避免两边口径漂移
    return reply.send({ items: CHART_TYPES });
  });

  // ---------- 图表 CRUD ----------
  app.post('/charts', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const body = parse(chartCreateSchema, req.body);
    const chartType = parseChartType(body.chartType);
    const config = toChartConfig(body.config);

    // 配置合法性与图表类型要求（最少维度/指标数）在这里一次性拦下
    const validation = validateChartConfig(chartType, config);
    if (!validation.ok) {
      throw new PeanutError('VALIDATION_FAILED', validation.errors.join('；') || '图表配置不合法', {
        issues: validation.errors,
      });
    }

    if (body.connectionId) {
      // 连接不可见时抛 NOT_FOUND，避免通过图表接口探测连接是否存在
      assertConnectionVisible(me, body.connectionId);
    }
    if (body.dashboardId) {
      const dash = ctx.pdb.dashboards.find(body.dashboardId);
      if (!dash) throw notFound('看板', body.dashboardId);
      assertOwned(dash.userId, me.user.id, isAdmin(me.roles), '看板', body.dashboardId);
    }

    const chart = ctx.pdb.charts.create(me.user.id, {
      name: body.name,
      chartType,
      dashboardId: body.dashboardId ?? null,
      connectionId: body.connectionId ?? null,
      dataSource: body.dataSource ?? (body.querySql ? 'query' : 'table'),
      sourceRef: body.sourceRef ?? null,
      querySql: body.querySql ?? null,
      config: config as unknown as Record<string, unknown>,
      refreshMode: body.refreshMode ?? 'manual',
      refreshSec: body.refreshSec ?? null,
    });

    ctx.pdb.audit.append({
      userId: me.user.id,
      username: me.user.username,
      action: 'create',
      resourceType: 'chart',
      resourceId: String(chart.id),
      status: 'success',
      ipAddress: clientIp(req),
      detail: { chartType, name: chart.name },
    });

    return reply.code(201).send(chart);
  });

  app.get('/charts', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const query = parse(
      z.object({
        dashboardId: z.coerce.number().int().optional(),
        allUsers: z.union([z.literal('true'), z.literal('false')]).optional(),
      }),
      req.query ?? {},
    );
    const scopedUserId = query.allUsers === 'true' && isAdmin(me.roles) ? null : me.user.id;
    const dashboardId =
      query.dashboardId === undefined ? undefined : Number.isNaN(query.dashboardId) ? null : query.dashboardId;
    return reply.send({ items: ctx.pdb.charts.list(scopedUserId, dashboardId) });
  });

  app.get('/charts/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const chart = ctx.pdb.charts.find(id);
    if (!chart) throw notFound('图表', id);
    assertOwned(chart.userId, me.user.id, isAdmin(me.roles), '图表', id);
    return reply.send(chart);
  });

  app.patch('/charts/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const existing = ctx.pdb.charts.find(id);
    if (!existing) throw notFound('图表', id);
    assertOwned(existing.userId, me.user.id, isAdmin(me.roles), '图表', id);

    const body = parse(chartUpdateSchema, req.body);
    const chartType = body.chartType ? parseChartType(body.chartType) : existing.chartType;
    const config = body.config ? toChartConfig(body.config) : (existing.config as unknown as ChartConfig);
    const validation = validateChartConfig(chartType, config);
    if (!validation.ok) {
      throw new PeanutError('VALIDATION_FAILED', validation.errors.join('；') || '图表配置不合法', {
        issues: validation.errors,
      });
    }
    if (body.connectionId) assertConnectionVisible(me, body.connectionId);

    const updated = ctx.pdb.charts.update(id, me.user.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      chartType,
      ...(body.dashboardId !== undefined ? { dashboardId: body.dashboardId } : {}),
      ...(body.connectionId !== undefined ? { connectionId: body.connectionId } : {}),
      ...(body.dataSource !== undefined ? { dataSource: body.dataSource } : {}),
      ...(body.sourceRef !== undefined ? { sourceRef: body.sourceRef } : {}),
      ...(body.querySql !== undefined ? { querySql: body.querySql } : {}),
      ...(body.refreshMode !== undefined ? { refreshMode: body.refreshMode } : {}),
      ...(body.refreshSec !== undefined ? { refreshSec: body.refreshSec } : {}),
      config: config as unknown as Record<string, unknown>,
    });
    return reply.send(updated);
  });

  app.delete('/charts/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const chart = ctx.pdb.charts.find(id);
    if (!chart) throw notFound('图表', id);
    assertOwned(chart.userId, me.user.id, isAdmin(me.roles), '图表', id);
    ctx.pdb.charts.remove(id);
    ctx.pdb.audit.append({
      userId: me.user.id,
      username: me.user.username,
      action: 'delete',
      resourceType: 'chart',
      resourceId: String(id),
      status: 'success',
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true });
  });

  /**
   * 取图表数据：由结构化配置生成 SQL 并执行。
   * 只有 SELECT 会被放行 —— 图表永远不该产生写操作。
   */
  // 取数接口会真的执行 SQL，因此必须要求 query.read：
  // 只挂 requireAuth 时，任何已登录用户都能借图表读到数据（连接可见性虽然校验了，
  // 但"能看见连接"不等于"被允许查询"）。
  app.get('/charts/:id/data', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const query = parse(dataQuerySchema, req.query ?? {});

    const chart = ctx.pdb.charts.find(id);
    if (!chart) throw notFound('图表', id);
    assertOwned(chart.userId, me.user.id, isAdmin(me.roles), '图表', id);
    if (!chart.connectionId) {
      throw new PeanutError('VALIDATION_FAILED', '该图表尚未绑定数据库连接，无法取数');
    }
    // 连接不可见 → NOT_FOUND（与连接接口保持一致，防止枚举）
    assertConnectionVisible(me, chart.connectionId);

    const config = chart.config as unknown as ChartConfig;
    const targetConfig = ctx.pdb.connections.getConfig(chart.connectionId);
    if (!targetConfig) throw notFound('连接', chart.connectionId);

    // 按目标库方言选择引号风格：MySQL 系必须用反引号
    const mysqlFamily = ['mysql', 'mariadb', 'tidb', 'oceanbase'];
    const quoteStyle: ChartQuoteStyle = mysqlFamily.includes(targetConfig.dbType) ? 'mysql' : 'standard';
    const defaultSchema = getDbTypeInfo(targetConfig.dbType).defaultSchema ?? null;

    let sql: string;
    if (chart.querySql && chart.dataSource === 'query') {
      sql = chart.querySql;
    } else {
      if (!chart.sourceRef) {
        throw new PeanutError(
          'VALIDATION_FAILED',
          '该图表未指定来源表（sourceRef），无法生成取数 SQL',
        );
      }
      sql = buildChartSql(config, {
        table: chart.sourceRef,
        schema: defaultSchema,
        quoteStyle,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      });
    }

    // 自定义 SQL 只能读：图表接口不应成为绕过写闸门的通道
    if (isWriteStatement(sql)) {
      throw new PeanutError('READONLY_VIOLATION', '图表取数只允许只读语句');
    }

    const result = await ctx.manager.withConnection(targetConfig, (conn) =>
      conn.getQueryExecutor().execute(sql, {
        maxRows: query.maxRows ?? ctx.pdb.settings.getNumber('query.max_rows', 10_000),
      }),
    );

    return reply.send({
      chartId: chart.id,
      chartType: chart.chartType,
      sql,
      columns: result.columns,
      rows: result.rows.map((row) => row.map(serializeCell)),
      rowCount: result.rowCount,
      truncated: result.truncated,
      durationMs: result.durationMs,
    });
  });

  // ---------- 看板 CRUD ----------
  app.post('/dashboards', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const body = parse(dashboardCreateSchema, req.body);
    const dashboard = ctx.pdb.dashboards.create(me.user.id, {
      name: body.name,
      description: body.description ?? null,
      layout: body.layout ?? null,
      isShared: body.isShared ?? false,
    });
    ctx.pdb.audit.append({
      userId: me.user.id,
      username: me.user.username,
      action: 'create',
      resourceType: 'dashboard',
      resourceId: String(dashboard.id),
      status: 'success',
      ipAddress: clientIp(req),
      detail: { name: dashboard.name },
    });
    return reply.code(201).send(dashboard);
  });

  app.get('/dashboards', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    return reply.send({ items: ctx.pdb.dashboards.list(me.user.id) });
  });

  app.get('/dashboards/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const dashboard = ctx.pdb.dashboards.find(id);
    if (!dashboard) throw notFound('看板', id);
    // 分享出去的看板允许他人只读查看
    if (!dashboard.isShared) {
      assertOwned(dashboard.userId, me.user.id, isAdmin(me.roles), '看板', id);
    }
    const charts = ctx.pdb.charts.list(dashboard.userId, id);
    return reply.send({ ...dashboard, charts });
  });

  app.patch('/dashboards/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const dashboard = ctx.pdb.dashboards.find(id);
    if (!dashboard) throw notFound('看板', id);
    assertOwned(dashboard.userId, me.user.id, isAdmin(me.roles), '看板', id);
    const body = parse(dashboardUpdateSchema, req.body);
    return reply.send(ctx.pdb.dashboards.update(id, body));
  });

  app.delete('/dashboards/:id', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const me = auth(req);
    const id = parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id;
    const dashboard = ctx.pdb.dashboards.find(id);
    if (!dashboard) throw notFound('看板', id);
    assertOwned(dashboard.userId, me.user.id, isAdmin(me.roles), '看板', id);
    ctx.pdb.dashboards.remove(id);
    ctx.pdb.audit.append({
      userId: me.user.id,
      username: me.user.username,
      action: 'delete',
      resourceType: 'dashboard',
      resourceId: String(id),
      status: 'success',
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true });
  });
}
