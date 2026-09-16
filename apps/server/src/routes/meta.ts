/**
 * 花生苗数据库管理工具 - 认证与元信息路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import { BUILTIN_PERMISSIONS, PeanutError, PRODUCT } from '@peanutsprout/core';
import { assertConnectionVisible, isProductionConnection } from '@peanutsprout/auth';
import { MIN_PASSWORD_LENGTH, WRITABLE_SETTINGS, readMustChangePassword } from '@peanutsprout/storage';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth, userAgent } from '../http.js';

/** 把白名单整理成界面可直接渲染的列表（类型与范围一并带出，避免前端再抄一份）。 */
function LIST_WRITABLE_SETTINGS(): Array<{
  key: string;
  category: string;
  type: string;
  min?: number;
  max?: number;
  values?: readonly string[];
  note: string;
}> {
  return Object.entries(WRITABLE_SETTINGS).map(([key, spec]) => ({
    key,
    category: spec.category,
    type: spec.type,
    ...(spec.min !== undefined ? { min: spec.min } : {}),
    ...(spec.max !== undefined ? { max: spec.max } : {}),
    ...(spec.values ? { values: spec.values } : {}),
    note: spec.note,
  }));
}

const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名').max(128),
  password: z.string().min(1, '请输入密码').max(256),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码').max(256),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `新密码至少 ${MIN_PASSWORD_LENGTH} 位`).max(256),
});

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/auth/login', { config: { rateLimit: false } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const result = ctx.auth.login({
      username: body.username,
      password: body.password,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    return reply.send({
      token: result.token,
      expiresIn: result.expiresIn,
      user: result.user,
      roles: result.roles,
      permissions: result.permissions,
      // 让界面能在登录后立刻把用户引导到改密页，而不是等他点什么都报 403。
      // 服务端仍然强制拦截（见 http.ts 的 requireAuth），前端只是把体验补齐。
      // 按**登录的这个用户**判定：全局键会被别的用户改密误清（已修）。
      mustChangePassword: readMustChangePassword(ctx.pdb, result.user.id),
    });
  });

  app.post('/auth/logout', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const auth = authOf(req);
    ctx.auth.logout(auth, clientIp(req));
    return reply.send({ ok: true });
  });

  /**
   * 续签：用当前有效令牌换一个新令牌。旧会话会被吊销（会话轮换），
   * 因此客户端拿到响应后必须立刻替换本地令牌，旧令牌随即失效。
   */
  app.post('/auth/refresh', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const auth = authOf(req);
    const result = ctx.auth.refresh(auth, { ip: clientIp(req), userAgent: userAgent(req) });
    return reply.send({
      token: result.token,
      expiresIn: result.expiresIn,
      user: result.user,
      roles: result.roles,
      permissions: result.permissions,
    });
  });

  app.get('/auth/me', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const auth = authOf(req);
    return reply.send({
      user: ctx.pdb.users.toDTO(auth.user),
      roles: auth.roles,
      permissions: auth.permissions,
      // 刷新页面后界面仍要知道"必须先改密"，否则重新加载就绕过了引导
      mustChangePassword: readMustChangePassword(ctx.pdb, auth.user.id),
    });
  });

  app.post('/auth/change-password', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(changePasswordSchema, req.body);
    ctx.auth.changePassword(auth, body.oldPassword, body.newPassword, clientIp(req));
    return reply.send({ ok: true });
  });
}

export async function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * 健康检查：**无需鉴权**，因此只回最少的存活信息。
   *
   * 之前这里还回传 schemaVersion 与 masterKeyMode，等于让任何能连到端口的人
   * 判断出"这个实例的本地库是否已被主密码保护"，为后续攻击提供线索。
   * 这两项对存活探测没有用处，已移除；需要它们的管理界面请走鉴权接口。
   */
  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      version: PRODUCT.version,
      product: PRODUCT.nameZh,
      uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
      // schemaVersion 保留：运维需要判断某个部署跑到哪一版迁移，
      // 它只暴露"本产品自身的内部版本号"，与主机路径、密钥保护方式无关。
      // masterKeyMode 则相反 —— 它等于告诉外人"本地库有没有被主密码保护"，已移除。
      schemaVersion: ctx.pdb.init.schemaVersion,
      // 仅当启动方（桌面端）显式传入 nonce 时才回显，用于确认"应答者是我启动的那个实例"。
      // 普通部署不传 → 该字段不出现，不会对外暴露任何额外信息。
      ...(ctx.config.instanceNonce ? { instanceNonce: ctx.config.instanceNonce } : {}),
    });
  });

  /**
   * 产品元信息：无需鉴权，因此**不含**任何服务端路径。
   *
   * dataDir / dbPath 曾在这里明文回传：任何能连到端口的人都能拿到服务端
   * 数据目录与本地库的绝对路径，用于后续路径相关攻击。
   * 前端与桌面端都不消费这两个字段（已 grep 确认），直接移除。
   * 服务端路径仍可通过 CLI（`peanutsprout init` 会打印数据目录）在**本机**查看。
   */
  app.get('/meta/info', async (_req, reply) => {
    return reply.send({
      nameZh: PRODUCT.nameZh,
      nameEn: PRODUCT.nameEn,
      short: PRODUCT.short,
      author: PRODUCT.author,
      wechat: PRODUCT.wechat,
      license: PRODUCT.license,
      licenseFull: PRODUCT.licenseFull,
      version: PRODUCT.version,
      implementedDrivers: ctx.registry.implementedTypes(),
    });
  });

  app.get('/meta/db-types', async (_req, reply) => {
    return reply.send({ items: ctx.registry.list() });
  });

  app.get('/meta/permissions', { preHandler: requireAuth(ctx) }, async (_req, reply) => {
    const fromDb = ctx.pdb.users.listPermissions();
    return reply.send({
      items:
        fromDb.length > 0
          ? fromDb
          : BUILTIN_PERMISSIONS.map((p, i) => ({ id: i + 1, ...p, description: null })),
    });
  });

  app.get('/meta/settings', { preHandler: requireAuth(ctx, 'settings.manage') }, async (_req, reply) => {
    return reply.send({ items: ctx.pdb.settings.all() });
  });

  /**
   * 写入设置项。
   *
   * 之前只有 GET，没有任何写入口 —— 于是 `ai.enabled` 这类开关永远是种子里的
   * 默认值，AI 功能虽然实现完整却**永远返回 AI_DISABLED**。这里补上入口，
   * 并且只认存储层的 `WRITABLE_SETTINGS` 白名单（见 sessions-settings.ts），
   * 白名单外的键直接 400，不静默忽略。
   *
   * 每一项变更都写审计（含旧值 → 新值），便于回答"谁在什么时候把 AI 打开了"。
   */
  app.put('/meta/settings', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(
      z.object({
        items: z
          .array(
            z.object({
              key: z.string().min(1),
              // 布尔 / 数字 / 字符串都接受，具体校验交给存储层的白名单
              value: z.union([z.string(), z.number(), z.boolean()]),
            }),
          )
          .min(1, '至少要提交一项设置')
          .max(50),
      }),
      req.body,
    );

    // 整体事务：任何一项非法则全部回滚，避免"改了一半"
    const changes = ctx.pdb.settings.setManyValidated(body.items);

    for (const change of changes) {
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'settings_update',
        resourceType: 'setting',
        resourceId: change.key,
        status: 'success',
        detail: { key: change.key, oldValue: change.oldValue, newValue: change.newValue },
        ipAddress: clientIp(req),
      });
    }

    return reply.send({ items: ctx.pdb.settings.all(), changes });
  });

  /** 列出可写设置项及其类型/范围，让界面不必硬编码一份白名单。 */
  app.get('/meta/settings/writable', { preHandler: requireAuth(ctx, 'settings.manage') }, async (_req, reply) => {
    return reply.send({ items: LIST_WRITABLE_SETTINGS() });
  });

  /**
   * 前端用它决定是否显示"生产环境"红标（PRD 4.1 连接颜色标识）。
   *
   * 安全关键：**"连接不存在"与"连接存在但调用者不可见"必须逐字节相同**。
   *
   * 旧实现先查库、查不到就直接 `return reply.send({ production: false, exists: false })`，
   * 只有"存在但不可见"才会走到 assertConnectionVisible 抛 404。实测两种情况的状态码
   * （200 vs 404）与响应体都不同，于是这个接口成了一个全库连接 id 枚举器：
   * 收到 404 说明"该 id 存在但对我隐藏"，收到 200 {exists:false} 说明"不存在"。
   *
   * 因此这里不再提前返回形状不同的 200：查不到时把同一个 id 交给
   * assertConnectionVisible 的出口（它抛的 `连接不存在: <id>` 与"存在但不可见"一致）。
   * 对"可见全部连接"的调用者（管理员，或没有任何授权记录的角色模式），
   * assertConnectionVisible 不会因 id 不存在而抛错，故补抛同一条消息，保持无差别。
   *
   * 成功分支同时移除了 `exists`：能查到的可见连接必然存在，该字段恒为 true；
   * `exists:false` 这条分支已不可能出现。前端未消费该字段（已 grep 确认
   * apps/web/src 与 packages 下均无 production-check / .exists 调用）。
   */
  app.get('/meta/production-check/:id', { preHandler: requireAuth(ctx, 'conn.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    const dto = ctx.pdb.connections.get(id);
    if (!dto) {
      // 与"存在但不可见"共用出口：assertConnectionVisible 会抛出
      // `连接不存在: <id>`；若调用者可见全部连接，它不会抛错，这里补抛同一条消息。
      assertConnectionVisible(auth, id);
      throw new PeanutError('NOT_FOUND', `连接不存在: ${id}`);
    }
    // 必须校验可见性：否则这个接口会变成"连接 id 是否存在"的探针，
    // 绕过本项目刻意统一的"未授权一律 NOT_FOUND"防枚举设计。
    assertConnectionVisible(auth, dto.id);
    return reply.send({
      production: isProductionConnection({ name: dto.name, colorTag: dto.colorTag, readOnly: dto.isReadOnly }),
      readOnly: dto.isReadOnly,
    });
  });

  /** 诊断包（PRD 5.5 一键导出）：不含任何口令与连接密文。 */
  app.get('/meta/diagnostics', { preHandler: requireAuth(ctx, 'settings.manage') }, async (_req, reply) => {
    const drivers = ctx.registry.list();
    const connections = ctx.pdb.connections.list({ limit: 2000 });
    return reply.send({
      generatedAt: new Date().toISOString(),
      product: { name: PRODUCT.nameZh, version: PRODUCT.version, license: PRODUCT.license },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      storage: {
        dbPath: ctx.pdb.dbPath,
        schemaVersion: ctx.pdb.init.schemaVersion,
        appliedMigrations: ctx.pdb.init.applied,
        masterKeyMode: ctx.pdb.masterKeyMode,
        userCount: ctx.pdb.users.count(),
      },
      drivers: drivers.map((d) => ({ dbType: d.dbType, implemented: d.driverImplemented, version: d.driverVersion })),
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        dbType: c.dbType,
        host: c.host,
        port: c.port,
        databaseName: c.databaseName,
        username: c.username,
        isReadOnly: c.isReadOnly,
      })),
      liveConnections: ctx.manager.stats(),
      auditChain: ctx.pdb.audit.verifyChain(),
    });
  });
}
