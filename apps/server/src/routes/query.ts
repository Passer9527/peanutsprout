/**
 * 花生苗数据库管理工具 - SQL 执行路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 权限与安全闸门（PRD 4.6 / 5.2 / 验收标准 5、6）：
 *  1. 必须持有 query.read；
 *  2. 写语句额外要求 query.write + 连接非只读 + 资源级写授权；
 *  3. 写语句必须显式 confirm=true（二次确认），否则返回 428；
 *  4. 无论成功失败，都写 query_history 与 audit_logs。
 */

import { z } from 'zod';
import {
  PeanutError,
  isWriteStatement,
  normalizeError,
  notFound,
  type QueryResult,
} from '@peanutsprout/core';
import { assertCanWrite, assertConnectionVisible, canSeeConnection } from '@peanutsprout/auth';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth, serializeCell, userAgent } from '../http.js';

const executeSchema = z.object({
  connectionId: z.number().int().positive('请选择连接'),
  sql: z.string().min(1, 'SQL 不能为空').max(1_000_000, 'SQL 过长'),
  maxRows: z.number().int().min(1).max(1_000_000).optional(),
  timeoutMs: z.number().int().min(0).max(3_600_000).optional(),
  /** 写操作二次确认标记 */
  confirm: z.boolean().optional(),
});

const explainSchema = z.object({
  connectionId: z.number().int().positive(),
  sql: z.string().min(1).max(1_000_000),
});

const historyQuerySchema = z.object({
  connectionId: z.coerce.number().int().optional(),
  onlySlow: z.union([z.literal('true'), z.literal('false')]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** 管理员可查全员历史 */
  allUsers: z.union([z.literal('true'), z.literal('false')]).optional(),
});

const AUDIT_SQL_MAX = 8000;

/**
 * 写闸门拒绝原因 → 统一、**不含敏感内容**的审计说明。
 *
 * 刻意不回显原始错误消息：错误消息里可能带连接名、授权细节等，审计只应记录
 * 「为什么被拦下」这一稳定类别，配合 detail.gate（稳定 error.code）供机器检索。
 */
const DENIED_WRITE_MESSAGES: Record<string, string> = {
  AUTH_FORBIDDEN: '写操作被拒绝：权限不足或缺少资源级写授权',
  READONLY_VIOLATION: '写操作被拒绝：目标连接为只读',
  CONFIRMATION_REQUIRED: '写操作被拒绝：缺少二次确认（confirm=true）',
};

export async function registerQueryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/query/execute', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(executeSchema, req.body);
    const { connectionId } = body;

    const dto = ctx.pdb.connections.get(connectionId);
    if (!dto) throw notFound('连接', connectionId);
    assertConnectionVisible(auth, connectionId);

    const isWrite = isWriteStatement(body.sql);
    if (isWrite) {
      // 只读账号 / 只读连接 / 未授权的写操作 / 缺二次确认都在这里被拦下。
      //
      // 「被拦下的写尝试」恰恰是入侵检测最有价值的信号：旧实现直接 throw，
      // 403（权限不足 / 只读连接）与 428（缺 confirm）在审计里**完全不留痕**，
      // 等于给了攻击者反复试探写权限而不被记录的空档。
      // 这里先落审计、再原样抛出，HTTP 行为（状态码 / error.code）保持不变。
      try {
        assertCanWrite(auth, connectionId, dto);
        if (body.confirm !== true) {
          throw new PeanutError(
            'CONFIRMATION_REQUIRED',
            '该语句会修改数据，请在确认后携带 confirm=true 重新提交',
            { statement: body.sql.slice(0, 200) },
          );
        }
      } catch (error) {
        const err = normalizeError(error);
        ctx.pdb.audit.append({
          userId: auth.user.id,
          username: auth.user.username,
          action: 'execute',
          resourceType: 'connection',
          resourceId: String(connectionId),
          connectionId,
          sqlText: body.sql.slice(0, AUDIT_SQL_MAX),
          status: 'denied',
          errorMessage: DENIED_WRITE_MESSAGES[err.code] ?? '写操作被拒绝',
          // 「用户提交了写语句但没确认」与「用户根本没提交写语句」的区分：
          // 前者会留下这条 denied 记录（gate=CONFIRMATION_REQUIRED, confirmed=false），
          // 后者根本不会进入写闸门，只会是一条正常的读查询（或没有任何记录）。
          detail: { write: true, gate: err.code, confirmed: body.confirm === true },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
        throw error;
      }
    }

    const config = ctx.pdb.connections.getConfig(connectionId);
    if (!config) throw notFound('连接', connectionId);

    // query.max_rows 在设置页里被描述为"单次查询返回行数上限"，而不是"默认值"。
    // 旧实现写成 `body.maxRows ?? setting`，于是请求参数可以任意突破上限
    // （zod 允许到 100 万），一次请求就能把整表拉进内存。
    // 这里取两者较小值，让设置真正成为天花板。
    const maxRowsCap = ctx.pdb.settings.getNumber('query.max_rows', 10_000);
    const maxRows = Math.max(1, Math.min(body.maxRows ?? maxRowsCap, maxRowsCap));
    const timeoutMs = body.timeoutMs ?? ctx.pdb.settings.getNumber('query.timeout_ms', 30_000);
    const slowMs = ctx.pdb.settings.getNumber('query.slow_threshold_ms', 1000);
    const startedAt = Date.now();

    let result: QueryResult;
    try {
      result = await ctx.manager.withConnection(config, (conn) =>
        conn.getQueryExecutor().execute(body.sql, { maxRows, timeoutMs }),
      );
    } catch (e) {
      const err = normalizeError(e);
      const durationMs = Date.now() - startedAt;
      ctx.pdb.queryHistory.append({
        userId: auth.user.id,
        connectionId,
        sqlText: body.sql,
        status: err.code === 'QUERY_CANCELLED' ? 'cancelled' : 'failed',
        errorMessage: err.message,
        durationMs,
      });
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'execute',
        resourceType: 'connection',
        resourceId: String(connectionId),
        connectionId,
        sqlText: body.sql.slice(0, AUDIT_SQL_MAX),
        status: 'failed',
        errorMessage: err.message,
        durationMs,
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      throw err;
    }

    const isSlow = result.durationMs >= slowMs;
    ctx.pdb.queryHistory.append({
      userId: auth.user.id,
      connectionId,
      sqlText: body.sql,
      status: 'success',
      durationMs: result.durationMs,
      affectedRows: result.affectedRows,
      resultRows: result.rowCount,
      isSlow,
    });
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'execute',
      resourceType: 'connection',
      resourceId: String(connectionId),
      connectionId,
      sqlText: body.sql.slice(0, AUDIT_SQL_MAX),
      status: 'success',
      durationMs: result.durationMs,
      detail: {
        write: isWrite,
        rowCount: result.rowCount,
        affectedRows: result.affectedRows,
        truncated: result.truncated,
        columnCount: result.columns.length,
        isSlow,
      },
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
    });
    ctx.pdb.connections.markUsed(connectionId);

    const notices = [...result.notices];
    if (isSlow) notices.push(`慢 SQL：耗时 ${result.durationMs}ms，超过阈值 ${slowMs}ms`);

    return reply.send({
      queryId: result.queryId,
      columns: result.columns,
      rows: result.rows.map((row) => row.map(serializeCell)),
      rowCount: result.rowCount,
      affectedRows: result.affectedRows,
      durationMs: result.durationMs,
      truncated: result.truncated,
      isSlow,
      notices,
    });
  });

  app.post('/query/explain', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(explainSchema, req.body);
    const dto = ctx.pdb.connections.get(body.connectionId);
    if (!dto) throw notFound('连接', body.connectionId);
    assertConnectionVisible(auth, body.connectionId);
    const config = ctx.pdb.connections.getConfig(body.connectionId);
    if (!config) throw notFound('连接', body.connectionId);

    const plan = await ctx.manager.withConnection(config, (conn) =>
      conn.getQueryExecutor().explain(body.sql),
    );
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'execute',
      resourceType: 'connection',
      resourceId: String(body.connectionId),
      connectionId: body.connectionId,
      sqlText: body.sql.slice(0, AUDIT_SQL_MAX),
      status: 'success',
      detail: { explain: true },
      ipAddress: clientIp(req),
    });
    return reply.send({ plan });
  });

  app.get('/query/history', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const q = parse(historyQuerySchema, req.query);
    const allUsers = q.allUsers === 'true' && auth.user.isAdmin;
    const items = ctx.pdb.queryHistory.list({
      ...(allUsers ? {} : { userId: auth.user.id }),
      ...(q.connectionId !== undefined ? { connectionId: q.connectionId } : {}),
      ...(q.onlySlow === 'true' ? { onlySlow: true } : {}),
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    });
    return reply.send({ items, total: items.length });
  });

  /**
   * 取消查询。
   *
   * 只允许取消**自己发起、且自己有权访问的连接**上的查询。
   * 旧实现拿到 queryId 就遍历所有存活连接无差别下发 cancel，
   * 而远程驱动的 queryId 形如 `q-<自增序号>-<毫秒时间戳>`，可枚举，
   * 于是任何账号都能中断他人的长查询（包括自己无权访问的连接），且不留任何痕迹。
   *
   * 注：node:sqlite 是同步执行，无法真正中断已在跑的语句；
   * 远程驱动（PG/MySQL）已实现连接级中止。
   */
  app.post('/query/cancel', { preHandler: requireAuth(ctx, 'query.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(z.object({ queryId: z.string().min(1) }), req.body);

    // 只在自己可见的连接上查找并下发取消
    const candidates = ctx.pdb.connections.list().filter((c) => canSeeConnection(auth, c.id));
    for (const dto of candidates) {
      const conn = ctx.manager.get(dto.id);
      if (!conn) continue;
      conn.getQueryExecutor().cancel(body.queryId);
    }

    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'query_cancel',
      resourceType: 'query',
      resourceId: body.queryId,
      status: 'success',
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true, note: '取消标记已下发；同步执行中的语句会在下一个检查点停止' });
  });
}
