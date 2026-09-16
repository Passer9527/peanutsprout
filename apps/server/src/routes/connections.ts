/**
 * 花生苗数据库管理工具 - 连接管理与元数据路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import { ALL_DATABASE_TYPES, PeanutError, notFound } from '@peanutsprout/core';
import { assertConnectionVisible, canSeeConnection, resolveConnectionScope } from '@peanutsprout/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth } from '../http.js';

const sshSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string().min(1),
    privateKeyPath: z.string().optional(),
    password: z.string().optional(),
    passphrase: z.string().optional(),
  })
  .nullable()
  .optional();

const sslSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['disable', 'prefer', 'require', 'verify-ca', 'verify-full']).optional(),
    caPath: z.string().optional(),
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
    rejectUnauthorized: z.boolean().optional(),
  })
  .nullable()
  .optional();

const connectionInputSchema = z.object({
  name: z.string().min(1, '连接名称不能为空').max(128),
  dbType: z.enum(ALL_DATABASE_TYPES as unknown as [string, ...string[]]),
  host: z.string().max(255).nullish(),
  port: z.number().int().min(1).max(65535).nullish(),
  databaseName: z.string().max(1024).nullish(),
  username: z.string().max(255).nullish(),
  password: z.string().max(1024).nullish(),
  connectionUrl: z.string().max(4096).nullish(),
  colorTag: z.string().max(32).nullish(),
  isReadOnly: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  groupId: z.number().int().nullish(),
  extraParams: z.record(z.string(), z.string()).nullish(),
  sshTunnel: sshSchema,
  ssl: sslSchema,
});

const connectionUpdateSchema = connectionInputSchema.partial();

const listQuerySchema = z.object({
  search: z.string().optional(),
  dbType: z.string().optional(),
  favorite: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
  groupId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function idParam(req: FastifyRequest): number {
  const { id } = req.params as { id: string };
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new PeanutError('VALIDATION_FAILED', `非法的连接 id: ${id}`);
  return n;
}

export async function registerConnectionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/connections', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const auth = authOf(req);
    const q = parse(listQuerySchema, req.query);
    const filter = {
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.dbType !== undefined ? { dbType: q.dbType } : {}),
      ...(q.favorite !== undefined ? { favorite: q.favorite === 'true' || q.favorite === '1' } : {}),
      ...(q.groupId !== undefined ? { groupId: q.groupId } : {}),
    };
    const limit = q.limit ?? null;
    const offset = q.offset ?? 0;

    // 资源级授权过滤必须在分页**之前**完成。
    // 旧实现把 limit/offset 交给 SQL、之后才过滤可见性，于是被收窄到某几条连接的用户
    // 一旦带上 ?limit= 就会翻出空列表（被授权的连接早被 SQL 的 LIMIT 截掉了），
    // 而 total 又只是当前页长度 —— 前端据此根本无法正确翻页。
    const scope = resolveConnectionScope(auth);
    if (scope.mode === 'all') {
      // 可见全部连接：分页可安全下推到 SQL，total 用真实计数
      const items = ctx.pdb.connections.list({
        ...filter,
        ...(limit !== null ? { limit } : {}),
        ...(offset > 0 ? { offset } : {}),
      });
      return reply.send({ items, total: ctx.pdb.connections.count(filter) });
    }

    // 白名单模式：先取全量候选、按授权过滤，再在内存里分页并给出真实 total
    const visible = ctx.pdb.connections.list(filter).filter((c) => canSeeConnection(auth, c.id));
    const total = visible.length;
    const start = offset > 0 ? offset : 0;
    const items = limit !== null ? visible.slice(start, start + limit) : visible.slice(start);
    return reply.send({ items, total });
  });

  app.get('/connections/groups', { preHandler: requireAuth(ctx, 'conn.read') }, async (_req, reply) => {
    return reply.send({ items: ctx.pdb.connections.listGroups() });
  });

  app.post('/connections/groups', { preHandler: requireAuth(ctx, 'conn.write') }, async (req, reply) => {
    const body = parse(z.object({ name: z.string().min(1), parentId: z.number().int().nullish() }), req.body);
    const id = ctx.pdb.connections.createGroup(body.name, body.parentId ?? null);
    return reply.status(201).send({ id });
  });

  app.delete(
    '/connections/groups/:id',
    { preHandler: requireAuth(ctx, 'conn.write') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = ctx.pdb.connections.deleteGroup(Number(id));
      if (!ok) throw notFound('分组', id);
      return reply.send({ ok: true });
    },
  );

  app.post('/connections', { preHandler: requireAuth(ctx, 'conn.write') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(connectionInputSchema, req.body);
    const item = ctx.pdb.connections.create({
      name: body.name,
      dbType: body.dbType,
      host: body.host ?? null,
      port: body.port ?? null,
      databaseName: body.databaseName ?? null,
      username: body.username ?? null,
      password: body.password ?? null,
      connectionUrl: body.connectionUrl ?? null,
      colorTag: body.colorTag ?? null,
      isReadOnly: body.isReadOnly ?? false,
      isFavorite: body.isFavorite ?? false,
      groupId: body.groupId ?? null,
      extraParams: body.extraParams ?? null,
      sshTunnel: body.sshTunnel ?? null,
      ssl: body.ssl ?? null,
    });
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'connection_create',
      resourceType: 'connection',
      resourceId: String(item.id),
      connectionId: item.id,
      status: 'success',
      detail: { name: item.name, dbType: item.dbType, host: item.host },
      ipAddress: clientIp(req),
    });
    return reply.status(201).send({ item });
  });

  app.get('/connections/:id', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    const item = ctx.pdb.connections.get(id);
    if (!item) throw notFound('连接', id);
    assertConnectionVisible(auth, id);
    return reply.send({ item });
  });

  app.put('/connections/:id', { preHandler: requireAuth(ctx, 'conn.write') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    if (!ctx.pdb.connections.get(id)) throw notFound('连接', id);
    // 写侧的资源级授权：与读侧（GET /connections/:id）保持一致。
    // 只查 conn.write 权限码是不够的 —— 那等于"能改所有连接"，
    // 与"普通用户只应操作被授权的连接"的设计（以及读侧行为）矛盾。
    assertConnectionVisible(auth, id);
    const body = parse(connectionUpdateSchema, req.body);
    const item = ctx.pdb.connections.update(id, body);
    // 连接管理器按 connection id 缓存已建立的会话（见 ConnectionManager.acquire），
    // 且只在 dbType/readOnly 变化时才重建。改了 host/port/database/username/
    // password/ssh/ssl 之后如果不主动丢弃，后续查询仍会打到**旧库**：
    // 界面显示的是新库，写操作却落进旧库，属于静默的数据错位。
    // 与 DELETE 的处理保持一致，改完即释放，下一次访问自然重连。
    await ctx.manager.release(id);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'connection_update',
      resourceType: 'connection',
      resourceId: String(id),
      connectionId: id,
      status: 'success',
      detail: { fields: Object.keys(body), passwordChanged: body.password !== undefined },
      ipAddress: clientIp(req),
    });
    return reply.send({ item });
  });

  app.delete('/connections/:id', { preHandler: requireAuth(ctx, 'conn.write') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    const item = ctx.pdb.connections.get(id);
    if (!item) throw notFound('连接', id);
    assertConnectionVisible(auth, id);
    await ctx.manager.release(id);
    ctx.pdb.connections.delete(id);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'connection_delete',
      resourceType: 'connection',
      resourceId: String(id),
      connectionId: id,
      status: 'success',
      detail: { name: item.name, dbType: item.dbType },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true });
  });

  app.post('/connections/:id/test', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    assertConnectionVisible(auth, id);
    const config = ctx.pdb.connections.getConfig(id);
    if (!config) throw notFound('连接', id);
    const result = await ctx.manager.test(config);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'connect',
      resourceType: 'connection',
      resourceId: String(id),
      connectionId: id,
      status: result.ok ? 'success' : 'failed',
      errorMessage: result.ok ? null : result.message,
      durationMs: result.latencyMs,
      ipAddress: clientIp(req),
    });
    // 连接测试失败是业务结果，不是服务端错误，统一 200 返回 ok=false
    return reply.send(result);
  });

  // ---------------------------------------------------------------- 元数据

  app.get('/connections/:id/schemas', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    assertConnectionVisible(auth, id);
    const config = ctx.pdb.connections.getConfig(id);
    if (!config) throw notFound('连接', id);
    const items = await ctx.manager.withConnection(config, (conn) => conn.getMetadata().listSchemas());
    ctx.pdb.connections.markUsed(id);
    return reply.send({ items });
  });

  app.get(
    '/connections/:id/schemas/:schema/tables',
    { preHandler: requireAuth(ctx, 'conn.read') },
    async (req, reply) => {
      const auth = authOf(req);
      const id = idParam(req);
      const { schema } = req.params as { schema: string };
      assertConnectionVisible(auth, id);
      const config = ctx.pdb.connections.getConfig(id);
      if (!config) throw notFound('连接', id);
      const items = await ctx.manager.withConnection(config, (conn) =>
        conn.getMetadata().listTables(schema),
      );
      return reply.send({ items, schema });
    },
  );

  app.get(
    '/connections/:id/schemas/:schema/tables/:table/columns',
    { preHandler: requireAuth(ctx, 'conn.read') },
    async (req, reply) => {
      const auth = authOf(req);
      const id = idParam(req);
      const { schema, table } = req.params as { schema: string; table: string };
      assertConnectionVisible(auth, id);
      const config = ctx.pdb.connections.getConfig(id);
      if (!config) throw notFound('连接', id);
      const items = await ctx.manager.withConnection(config, (conn) =>
        conn.getMetadata().listColumns(schema, table),
      );
      return reply.send({ items, schema, table });
    },
  );

  app.get(
    '/connections/:id/schemas/:schema/tables/:table/indexes',
    { preHandler: requireAuth(ctx, 'conn.read') },
    async (req, reply) => {
      const auth = authOf(req);
      const id = idParam(req);
      const { schema, table } = req.params as { schema: string; table: string };
      assertConnectionVisible(auth, id);
      const config = ctx.pdb.connections.getConfig(id);
      if (!config) throw notFound('连接', id);
      const items = await ctx.manager.withConnection(config, (conn) =>
        conn.getMetadata().listIndexes(schema, table),
      );
      return reply.send({ items, schema, table });
    },
  );

  app.get(
    '/connections/:id/capabilities',
    { preHandler: requireAuth(ctx, 'conn.read') },
    async (req, reply) => {
      const auth = authOf(req);
      const id = idParam(req);
      const dto = ctx.pdb.connections.get(id);
      if (!dto) throw notFound('连接', id);
      // 与其余连接子资源接口（schemas/tables/columns/indexes/flags）保持一致：
      // 少了这一步，遍历 id 就能区分"不存在"与"存在但未授权"，
      // 并把对方的数据库类型探出来 —— 正是本项目统一防的枚举手法。
      assertConnectionVisible(auth, id);
      const driver = ctx.registry.require(dto.dbType);
      return reply.send({
        dbType: dto.dbType,
        implemented: driver.implemented,
        driverName: driver.name,
        driverVersion: driver.version,
        capabilities: driver.capabilities,
      });
    },
  );

  // 保留只读/收藏这类高频开关为独立端点，前端一次点击即可完成
  app.patch('/connections/:id/flags', { preHandler: requireAuth(ctx, 'conn.write') }, async (req, reply) => {
    const auth = authOf(req);
    const id = idParam(req);
    if (!ctx.pdb.connections.get(id)) throw notFound('连接', id);
    assertConnectionVisible(auth, id);
    const body = parse(
      z.object({ isFavorite: z.boolean().optional(), isReadOnly: z.boolean().optional() }),
      req.body,
    );
    const patch: Record<string, boolean> = {};
    if (body.isFavorite !== undefined) patch['isFavorite'] = body.isFavorite;
    if (body.isReadOnly !== undefined) patch['isReadOnly'] = body.isReadOnly;
    const item = ctx.pdb.connections.update(id, patch);
    return reply.send({ item });
  });
}
