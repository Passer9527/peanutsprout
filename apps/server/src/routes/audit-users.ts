/**
 * 花生苗数据库管理工具 - 审计与用户管理路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import { PeanutError, notFound } from '@peanutsprout/core';
import {
  hashSecret,
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  AuditRepository,
} from '@peanutsprout/storage';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth } from '../http.js';

const auditQuerySchema = z.object({
  userId: z.coerce.number().int().optional(),
  username: z.string().optional(),
  action: z.string().optional(),
  connectionId: z.coerce.number().int().optional(),
  status: z.enum(['success', 'failed', 'denied']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/audit/logs', { preHandler: requireAuth(ctx, 'audit.read') }, async (req, reply) => {
    const q = parse(auditQuerySchema, req.query);
    const { items, total } = ctx.pdb.audit.query(q);
    return reply.send({ items, total });
  });

  app.get('/audit/logs/export', { preHandler: requireAuth(ctx, 'audit.read') }, async (req, reply) => {
    const auth = authOf(req);
    const q = parse(
      auditQuerySchema.extend({ format: z.enum(['csv', 'json']).optional() }),
      req.query,
    );
    const format = q.format ?? 'csv';
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'export',
      resourceType: 'audit_logs',
      status: 'success',
      detail: { format, filter: q },
      ipAddress: clientIp(req),
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 流式导出：逐批读、逐行写。
    // 旧实现先 queryAll（最多 10 万行）再 join 成一个字符串，sql_text 单行上限 8000 字符，
    // 很容易产生上百 MB 的中间数组 + 最终字符串，而且全程同步、事件循环被完全阻塞。
    // 这里改为按 id 游标分批读取并写入响应流，峰值内存只有一批（1000 行）。
    const BATCH = 1000;
    const MAX_ROWS = 100_000;
    // 接管响应：直接写 reply.raw 时必须 hijack，否则 Fastify 也会去写自己的响应，
    // 而且 reply.header() 设的头不会随 raw 写入一起发出（实测 content-type 会丢）。
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type':
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${stamp}.${format}"`,
      'x-audit-export-max-rows': String(MAX_ROWS),
    });

    let written = 0;
    let afterId = 0;
    // hijack 之后 Fastify 不能再接管响应，因此中途出错必须自己收尾：
    // 否则异常会冒泡到一个"已经交出响应权"的错误处理器，连接悬在那里不结束。
    try {
    if (format === 'csv') {
      // BOM：Excel 打开中文不乱码
      reply.raw.write('\uFEFF');
      reply.raw.write(`${AuditRepository.CSV_HEADER.join(',')}\r\n`);
      for (;;) {
        const batch = ctx.pdb.audit.queryBatch(q, afterId, BATCH);
        if (batch.length === 0) break;
        let chunk = '';
        for (const entry of batch) {
          chunk += `${AuditRepository.csvLine(entry)}\r\n`;
          afterId = entry.id;
        }
        written += batch.length;
        // 背压：写不进去就等 drain，避免把整个结果堆在内存里
        if (!reply.raw.write(chunk)) {
          await new Promise<void>((resolve) => reply.raw.once('drain', () => resolve()));
        }
        if (written >= MAX_ROWS) break;
      }
      reply.raw.end();
    } else {
      reply.raw.write('[');
      let first = true;
      for (;;) {
        const batch = ctx.pdb.audit.queryBatch(q, afterId, BATCH);
        if (batch.length === 0) break;
        let chunk = '';
        for (const entry of batch) {
          chunk += `${first ? '' : ','}${JSON.stringify(entry, null, 2)}`;
          first = false;
          afterId = entry.id;
        }
        written += batch.length;
        if (!reply.raw.write(chunk)) {
          await new Promise<void>((resolve) => reply.raw.once('drain', () => resolve()));
        }
        if (written >= MAX_ROWS) break;
      }
      reply.raw.write(']');
      reply.raw.end();
    }
    } catch (error) {
      // 已经可能写出去一部分内容，无法再改成错误响应；只能中断连接并记日志，
      // 让客户端看到"传输被截断"而不是拿到一份被当成完整文件保存的半截导出。
      req.log.error({ err: error }, 'audit export stream failed');
      reply.raw.destroy(error instanceof Error ? error : undefined);
      return reply;
    }
    // 已经直接写入原始响应流，告诉 Fastify 不要再接管
    return reply;
  });

  app.get('/audit/verify', { preHandler: requireAuth(ctx, 'audit.read') }, async (req, reply) => {
    const auth = authOf(req);
    const result = ctx.pdb.audit.verifyChain();
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'audit_verify',
      resourceType: 'audit_logs',
      status: result.ok ? 'success' : 'failed',
      detail: result,
      ipAddress: clientIp(req),
    });
    return reply.send(result);
  });

  app.get('/audit/stats', { preHandler: requireAuth(ctx, 'audit.read') }, async (_req, reply) => {
    const { total } = ctx.pdb.audit.query({ limit: 1 });
    const failed = ctx.pdb.audit.query({ status: 'failed', limit: 1 }).total;
    const denied = ctx.pdb.audit.query({ status: 'denied', limit: 1 }).total;
    const loginFailed = ctx.pdb.audit.query({ action: 'login', status: 'failed', limit: 1 }).total;
    return reply.send({ total, failed, denied, loginFailed });
  });

  app.post('/audit/purge', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(z.object({ before: z.string().min(1) }), req.body);
    const deleted = ctx.pdb.audit.purge(body.before);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'settings_update',
      resourceType: 'audit_logs',
      status: 'success',
      detail: { purgeBefore: body.before, deleted },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true, deleted, chainAnchored: true });
  });
}

const createUserSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(MIN_PASSWORD_LENGTH, `密码至少 ${MIN_PASSWORD_LENGTH} 位`).max(256),
  displayName: z.string().max(64).nullish(),
  email: z.string().email('邮箱格式不正确').nullish(),
  phone: z.string().max(32).nullish(),
  isAdmin: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
});

const updateUserSchema = z.object({
  displayName: z.string().max(64).nullish(),
  email: z.string().email('邮箱格式不正确').nullish(),
  phone: z.string().max(32).nullish(),
  status: z.number().int().min(0).max(1).optional(),
  isAdmin: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
  /** 管理员重置口令 */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(256).optional(),
  unlock: z.boolean().optional(),
});

export async function registerUserRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/users', { preHandler: requireAuth(ctx, 'user.manage') }, async (_req, reply) => {
    const items = ctx.pdb.users.list().map((u) => ctx.pdb.users.toDTO(u));
    return reply.send({ items, total: items.length });
  });

  app.get('/users/roles', { preHandler: requireAuth(ctx, 'user.manage') }, async (_req, reply) => {
    return reply.send({ items: ctx.pdb.users.listRoles() });
  });

  app.post('/users', { preHandler: requireAuth(ctx, 'user.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(createUserSchema, req.body);
    const weak = checkPasswordStrength(body.password);
    if (weak) throw new PeanutError('VALIDATION_FAILED', weak);

    const roles = body.roles && body.roles.length > 0 ? body.roles : [body.isAdmin ? 'admin' : 'readonly'];
    const created = ctx.pdb.users.create({
      username: body.username,
      passwordHash: hashSecret(body.password),
      displayName: body.displayName ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      isAdmin: body.isAdmin ?? roles.includes('admin'),
      roles,
    });
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'user_create',
      resourceType: 'user',
      resourceId: String(created.id),
      status: 'success',
      detail: { username: created.username, roles, isAdmin: created.isAdmin },
      ipAddress: clientIp(req),
    });
    return reply.status(201).send({ item: ctx.pdb.users.toDTO(created) });
  });

  app.put('/users/:id', { preHandler: requireAuth(ctx, 'user.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new PeanutError('VALIDATION_FAILED', '非法的用户 id');
    const body = parse(updateUserSchema, req.body);

    if (body.password) {
      const weak = checkPasswordStrength(body.password);
      if (weak) throw new PeanutError('VALIDATION_FAILED', weak);
      ctx.auth.resetPassword(auth, id, body.password);
    }
    if (body.unlock) ctx.pdb.users.unlock(id);
    if (body.roles) ctx.pdb.users.setRoles(id, body.roles);

    const patch: Parameters<typeof ctx.pdb.users.update>[1] = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName ?? null;
    if (body.email !== undefined) patch.email = body.email ?? null;
    if (body.phone !== undefined) patch.phone = body.phone ?? null;
    if (body.status !== undefined) patch.status = body.status;
    if (body.isAdmin !== undefined) patch.isAdmin = body.isAdmin;

    let user = ctx.pdb.users.findById(id);
    if (!user) throw notFound('用户', id);
    if (Object.keys(patch).length > 0) user = ctx.pdb.users.update(id, patch);

    // 禁用或降权后，立即吊销其在线会话
    if (body.status === 0) ctx.pdb.sessions.revokeAllForUser(id);
    if (body.password) ctx.pdb.sessions.revokeAllForUser(id);

    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'user_update',
      resourceType: 'user',
      resourceId: String(id),
      status: 'success',
      detail: {
        fields: Object.keys(body),
        passwordReset: Boolean(body.password),
      },
      ipAddress: clientIp(req),
    });
    return reply.send({ item: ctx.pdb.users.toDTO(user) });
  });

  app.delete('/users/:id', { preHandler: requireAuth(ctx, 'user.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new PeanutError('VALIDATION_FAILED', '非法的用户 id');
    if (id === auth.user.id) throw new PeanutError('CONFLICT', '不能删除当前登录账号');
    const target = ctx.pdb.users.findById(id);
    if (!target) throw notFound('用户', id);
    ctx.pdb.users.delete(id);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'user_delete',
      resourceType: 'user',
      resourceId: String(id),
      status: 'success',
      detail: { username: target.username },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true });
  });

  /** 资源级授权配置（PRD 4.6 按连接/库/表授权）。 */
  app.get('/users/:id/grants', { preHandler: requireAuth(ctx, 'user.manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!ctx.pdb.users.findById(id)) throw notFound('用户', id);
    return reply.send({ items: ctx.pdb.users.grantsOf(id) });
  });

  app.put('/users/:id/grants', { preHandler: requireAuth(ctx, 'user.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    if (!ctx.pdb.users.findById(id)) throw notFound('用户', id);
    const body = parse(
      z.object({
        grants: z.array(
          z.object({
            resourceType: z.enum(['connection', 'schema', 'table']),
            resourceId: z.string().min(1),
            actions: z.array(z.enum(['read', 'write', '*'])).min(1),
          }),
        ),
      }),
      req.body,
    );
    ctx.pdb.users.setGrants(id, body.grants);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'user_update',
      resourceType: 'user',
      resourceId: String(id),
      status: 'success',
      detail: { grants: body.grants.length },
      ipAddress: clientIp(req),
    });
    return reply.send({ items: ctx.pdb.users.grantsOf(id) });
  });
}
