/**
 * 花生苗数据库管理工具 - HTTP 支撑：校验、鉴权、错误归一化
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PeanutError, normalizeError, type AuthContext } from '@peanutsprout/core';
import { assertPermission } from '@peanutsprout/auth';
import { readMustChangePassword } from '@peanutsprout/storage';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** 由 requireAuth 注入的请求上下文 */
    auth?: AuthContext;
    startedAtMs?: number;
  }
}

/**
 * 结构化校验：不依赖具体 zod 版本的泛型形状，
 * 这样 zod 大版本升级不会波及全部路由文件。
 */
export interface SafeParser<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

export function parse<T>(schema: SafeParser<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new PeanutError(
      'VALIDATION_FAILED',
      '请求参数校验失败',
      result.error.issues.map((i) => ({
        field: i.path.map((p) => String(p)).join('.'),
        message: i.message,
      })),
    );
  }
  return result.data;
}

/**
 * 取请求来源 IP（写入审计日志、参与登录限流）。
 *
 * 安全关键：**必须只用 req.ip，绝不自己解析 X-Forwarded-For**。
 *
 * 早期实现在这里直接读 `x-forwarded-for` 的首段并优先返回它，等于绕过了
 * Fastify 的 trustProxy 机制：哪怕服务端配置成"不信任任何代理"，
 * 任何能直连端口的人只要加一个 `X-Forwarded-For: 1.2.3.4` 就能让审计日志
 * 记下伪造的来源 IP，也能靠不断变换该头绕过按 IP 统计的登录限流。
 * req.ip 会依据 trustProxy 配置决定是取 TCP 对端地址还是采信转发头，
 * 因此把信任决策集中在一处（config.trustProxy，默认 false）。
 */
export function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}

export function userAgent(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : null;
}

/**
 * 仍在使用内置默认口令时，只放行这几个接口 —— 其余一律拒绝。
 *
 * 放行清单刻意包含 `/auth/me`：界面需要拿到身份信息才能把用户引导到改密页；
 * 也包含 logout/refresh，否则用户连"退出重登"都做不到。
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  'POST /auth/change-password',
  'POST /auth/logout',
  'POST /auth/refresh',
  'GET /auth/me',
]);

/**
 * 该用户是否仍处于「必须改密」状态（按用户判定，不是全局开关）。
 *
 * 按用户的原因见 packages/storage/src/index.ts 的 writeMustChangePassword：
 * 全局键会被任意用户的改密动作误清，从而悄悄解除管理员的强制改密。
 */
function isPasswordChangePending(ctx: AppContext, userId: number): boolean {
  return readMustChangePassword(ctx.pdb, userId);
}

/**
 * 默认口令强制改密闸门。
 *
 * 这个开关以前**只写不读**：引导时写入 `security.must_change_password = true`，
 * 却没有一处代码读它，于是内置的 admin/123456 可以长期用于登录并调用全部接口 ——
 * 「首次登录强制改密」实际上从未生效。这里把它接上。
 */
function assertPasswordChangedIfPending(
  ctx: AppContext,
  req: FastifyRequest,
  authCtx: AuthContext,
): void {
  if (!isPasswordChangePending(ctx, authCtx.user.id)) return;
  // 管理员改了密码之后本闸门自然消失；此处不再对管理员网开一面，
  // 否则默认口令就能永久使用下去。
  // 注意：Fastify 的 routeOptions.url 是否带插件前缀（/api/v1）并不稳定，
  // 因此这里统一把前缀剥掉再比对；否则改密接口自己会被闸门拦下，
  // 用户将永久无法改密（一个自己把自己锁死的闸门）。
  const raw = req.routeOptions?.url ?? req.url.split('?')[0] ?? req.url;
  const route = raw.replace(/^\/api\/v\d+/, '');
  if (PASSWORD_CHANGE_ALLOWLIST.has(`${req.method.toUpperCase()} ${route}`)) return;
  void authCtx;
  throw new PeanutError(
    'PASSWORD_CHANGE_REQUIRED',
    '当前仍在使用初始口令，请先修改密码',
    { changePasswordUrl: '/api/v1/auth/change-password' },
  );
}

/** 生成 preHandler：校验 Bearer 令牌，可选地再校验权限码。 */
export function requireAuth(ctx: AppContext, permission?: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new PeanutError('AUTH_REQUIRED', '请先登录');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new PeanutError('AUTH_REQUIRED', '请先登录');
    const authCtx = ctx.auth.authenticate(token);
    req.auth = authCtx;
    assertPasswordChangedIfPending(ctx, req, authCtx);
    if (permission) assertPermission(authCtx, permission);
  };
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new PeanutError('AUTH_REQUIRED', '请先登录');
  return req.auth;
}

/** BLOB 无法直接 JSON 序列化，转成可识别的 base64 字符串。 */
export function serializeCell(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    const peanut = normalizeError(error);
    // 5xx 才需要打印堆栈；4xx 是正常的业务拒绝，打日志会淹没审计
    if (peanut.status >= 500) {
      req.log.error({ err: error, code: peanut.code }, 'request failed');
    } else {
      req.log.debug({ code: peanut.code, message: peanut.message }, 'request rejected');
    }
    void reply.status(peanut.status).send(peanut.toJSON());
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `接口不存在: ${req.method} ${req.url}` },
    });
  });
}

export function registerRequestTiming(app: FastifyInstance): void {
  app.addHook('onRequest', async (req) => {
    req.startedAtMs = Date.now();
  });
  app.addHook('onResponse', async (req, reply) => {
    const start = req.startedAtMs;
    if (start === undefined) return;
    const ms = Date.now() - start;
    if (ms > 1000) {
      req.log.warn({ url: req.url, method: req.method, ms, status: reply.statusCode }, 'slow request');
    }
  });
}
