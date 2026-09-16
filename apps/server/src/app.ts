/**
 * 花生苗数据库管理工具 - Fastify 应用装配
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

import { PRODUCT } from '@peanutsprout/core';
import type { AppContext } from './context.js';
import { registerErrorHandler, registerRequestTiming } from './http.js';
import { registerAuthRoutes, registerMetaRoutes } from './routes/meta.js';
import { registerConnectionRoutes } from './routes/connections.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerDataExportRoutes } from './routes/data-export.js';
import { registerTableDataRoutes } from './routes/table-data.js';
import { registerDdlRoutes } from './routes/ddl.js';
import { registerAuditRoutes, registerUserRoutes } from './routes/audit-users.js';
import { registerAiRoutes, registerMigrationRoutes } from './routes/ai-migration.js';
import { registerVisualizationRoutes } from './routes/visualization.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根目录：apps/server/src -> ../../../ */
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** 找到 Web 端构建产物目录；找不到就返回 null（纯 API 模式）。 */
export function resolveWebDist(explicit?: string | null): string | null {
  const candidates = [
    explicit ?? null,
    join(REPO_ROOT, 'apps', 'web', 'dist'),
    join(HERE, '..', 'web'),
    join(HERE, '..', '..', 'web'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export interface BuildServerOptions {
  /** 覆盖静态资源目录（测试用） */
  webDist?: string | null;
  /** 关闭日志（测试用） */
  quiet?: boolean;
}

/**
 * CORS 默认策略：只放行本机来源（localhost / 127.0.0.1 / ::1，任意端口）。
 *
 * 无 Origin 头的请求（同源、curl、CLI、Electron 主进程）直接放行 —— CORS 是
 * 浏览器侧的机制，没有 Origin 就不存在跨源读取的问题。
 */
function isLocalOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow: boolean) => void,
): void {
  if (!origin) {
    cb(null, true);
    return;
  }
  try {
    const { hostname } = new URL(origin);
    cb(null, hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]');
  } catch {
    cb(null, false);
  }
}

export async function buildServer(
  ctx: AppContext,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const https = ctx.config.https
    ? {
        key: readFileSync(ctx.config.https.keyPath),
        cert: readFileSync(ctx.config.https.certPath),
      }
    : null;

  const app = Fastify({
    logger: options.quiet ? false : { level: ctx.config.logLevel },
    // 导入大文件/大 SQL 脚本时需要放宽 body 限制
    // 4MB：本服务没有任何需要超大 body 的接口（SQL 文本由 zod 限到 1MB，
    // 也没有文件上传路由）。原来的 64MB 且 Fastify 在鉴权**之前**就完成 body 解析，
    // 未登录的人反复 POST 64MB 就能放大内存占用。
    bodyLimit: 4 * 1024 * 1024,
    // 默认**不信任** X-Forwarded-*（ctx.config.trustProxy 默认 false）：
    // trustProxy: true 会让请求方用 X-Forwarded-For 随意自称来源 IP，
    // 从而污染审计 clientIp 并绕过按 IP 的登录限流。
    // 只有部署在反向代理之后、且后端端口仅代理可达时，才用
    // PEANUTSPROUT_TRUST_PROXY 显式开启（也可只列可信网段）。
    trustProxy: ctx.config.trustProxy,
    ...(https ? { https } : {}),
  });

  registerRequestTiming(app);
  registerErrorHandler(app);

  await app.register(cors, {
    // 未显式配置跨域来源时，**只允许本机来源**。
    // 服务端自己托管 Web 界面（serveWeb），同源请求本就不需要 CORS；
    // 开发时 vite 用 proxy 转发 /api，浏览器看到的同样是同源请求。
    // 旧默认值是 `true`（反射任意来源），意味着用户浏览器里打开的任意网页
    // 都能读取本服务的响应 —— 包括用默认口令 admin/123456 试登录的结果。
    origin: ctx.config.corsOrigin ?? isLocalOrigin,
    // 本服务全程使用 `Authorization: Bearer` 令牌，不依赖 Cookie。
    // 关掉 credentials 后，即便有人把来源放开，浏览器也不会把本服务
    // 当作"可带凭据访问"的目标。
    credentials: false,
    exposedHeaders: ['content-disposition'],
  });

  await app.register(
    async (api) => {
      await registerMetaRoutes(api, ctx);
      await registerAuthRoutes(api, ctx);
      await registerConnectionRoutes(api, ctx);
      await registerQueryRoutes(api, ctx);
      await registerDataExportRoutes(api, ctx);
      await registerTableDataRoutes(api, ctx);
      await registerDdlRoutes(api, ctx);
      await registerAuditRoutes(api, ctx);
      await registerUserRoutes(api, ctx);
      await registerAiRoutes(api, ctx);
      await registerMigrationRoutes(api, ctx);
      await registerVisualizationRoutes(api, ctx);
    },
    { prefix: '/api/v1' },
  );

  const webDist = ctx.config.serveWeb ? resolveWebDist(options.webDist ?? ctx.config.webDistPath) : null;
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.log.info({ webDist }, '已托管 Web 端静态资源');
  }

  app.get('/', async (_req, reply) => {
    if (webDist) return reply.sendFile('index.html');
    return reply.send({
      product: PRODUCT.nameZh,
      productEn: PRODUCT.nameEn,
      version: PRODUCT.version,
      author: PRODUCT.author,
      wechat: PRODUCT.wechat,
      license: PRODUCT.license,
      api: '/api/v1/health',
      message: 'Web 端尚未构建。开发模式请运行 pnpm dev:web，或执行 pnpm --filter @peanutsprout/web build。',
    });
  });

  return app;
}
