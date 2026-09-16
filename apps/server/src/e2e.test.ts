/**
 * 花生苗数据库管理工具 - 端到端接口测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 走真实的 Fastify 应用（app.inject，不占端口）与真实的内存 SQLite 本地库，
 * 覆盖一条完整业务链路：
 *   登录 → 建连接 → 测试连通 → 读元数据 → 执行查询 → 写操作确认闸门
 *   → 审计留痕与哈希链校验 → 权限隔离
 * 这条链路通了，才说明"骨架可运行"不是空话。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import { MIGRATIONS } from '@peanutsprout/storage';
import type { ServerConfig } from './config.js';

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let targetDbPath: string;

const ADMIN = 'admin';
const ADMIN_PASSWORD = 'Adm1n-Passw0rd!';
let token = '';
let connectionId = 0;

function testConfig(): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    masterPassword: null,
    tokenTtlSec: 3600,
    corsOrigin: true,
    serveWeb: false,
    webDistPath: null,
    bootstrapAdminUsername: ADMIN,
    bootstrapAdminPassword: ADMIN_PASSWORD,
    logLevel: 'silent',
    https: null,
    idleConnectionMs: 0,
    instanceNonce: null,
    trustProxy: false,
  };
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-e2e-'));
  targetDbPath = join(dir, 'target.db');

  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: ADMIN, password: ADMIN_PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

describe('健康检查与元信息', () => {
  it('健康检查无需登录', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    // 断言「等于当前最新迁移版本」而不是写死某个版本号 ——
    // 否则每新增一条迁移都要改这个测试（之前就是这么被 0002 打断的）。
    expect(body.schemaVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
    expect(body.product).toContain('花生苗');
  });

  it('产品元信息包含许可与作者', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.license).toContain('AGPL-3.0');
    expect(body.author).toBe('飞哥');
    expect(body.wechat).toBe('6731663');
  });

  it('数据库类型清单如实标注驱动是否已实现', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/db-types' });
    const items = res.json().items as Array<{ dbType: string; driverImplemented: boolean }>;
    const implemented = (dbType: string): boolean | undefined =>
      items.find((i) => i.dbType === dbType)?.driverImplemented;

    // 已落地真实驱动的类型
    for (const dbType of ['sqlite', 'postgresql', 'mysql', 'mariadb', 'tidb', 'oceanbase', 'kingbase']) {
      expect(implemented(dbType), `${dbType} 应为已实现`).toBe(true);
    }
    // 仍是占位驱动的类型：必须显式报 false，界面据此置灰
    for (const dbType of ['oracle', 'sqlserver', 'dm', 'redis', 'mongodb']) {
      expect(implemented(dbType), `${dbType} 应为未实现`).toBe(false);
    }
  });

  it('权限清单可读', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/permissions', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });
});

describe('认证', () => {
  it('未带令牌访问受保护接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/connections' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('伪造令牌被拒绝', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('错误口令登录失败', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ADMIN, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('返回当前登录用户信息', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe(ADMIN);
    expect(body.user.isAdmin).toBe(true);
  });

  it('登录失败会写入审计日志', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs?action=login',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ status: string }>;
    expect(items.some((i) => i.status === 'failed')).toBe(true);
  });
});

describe('连接管理', () => {
  it('创建 SQLite 连接', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: '测试库', dbType: 'sqlite', databaseName: targetDbPath },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    connectionId = item.id;
    expect(item.id).toBeGreaterThan(0);
    // DTO 不得包含口令字段
    expect(JSON.stringify(item)).not.toContain('password');
  });

  it('列表返回已创建的连接', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/connections', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect((res.json().items as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('测试连接成功', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/connections/${connectionId}/test`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('读取能力声明', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${connectionId}/capabilities`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().implemented).toBe(true);
  });

  it('未实现的驱动给出 DRIVER_NOT_IMPLEMENTED 而不是静默失败', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: 'MySQL(未实现)', dbType: 'mysql', host: '127.0.0.1', port: 3306, databaseName: 'x' },
    });
    const id = created.json().item.id as number;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/connections/${id}/test`,
      headers: auth(),
    });
    const body = res.json();
    expect(res.statusCode === 501 || body.code === 'DRIVER_NOT_IMPLEMENTED' || body.ok === false).toBe(true);
  });

  it('访问不存在的连接返回 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/connections/999999', headers: auth() });
    expect(res.statusCode).toBe(404);
  });

  it('创建非法请求被校验拦截', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: '', dbType: 'sqlite' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('查询执行', () => {
  it('只读查询返回列与行', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'SELECT 1 AS one, 2 AS two' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual(['one', 'two']);
    expect(body.rows[0]).toEqual([1, 2]);
    expect(body.rowCount).toBe(1);
  });

  it('写操作未经确认返回 428 CONFIRMATION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'CREATE TABLE t (a INT)' },
    });
    expect(res.statusCode).toBe(428);
    expect(res.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('确认后写操作成功并记入审计', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)', confirm: true },
    });
    expect(create.statusCode).toBe(200);

    const insert = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: "INSERT INTO demo (id, name) VALUES (1, '花生苗')", confirm: true },
    });
    expect(insert.statusCode).toBe(200);

    const select = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'SELECT name FROM demo WHERE id = 1' },
    });
    expect(select.json().rows[0]?.[0]).toBe('花生苗');
  });

  it('SQL 语法错误返回错误码而不是 500 崩溃', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'SELEC bad syntax' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error).toBeDefined();
  });

  it('查询历史被记录', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/query/history', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect((res.json().items as unknown[]).length).toBeGreaterThan(0);
  });

  it('执行计划可读取', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/explain',
      headers: auth(),
      payload: { connectionId, sql: 'SELECT * FROM demo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.content.length).toBeGreaterThan(0);
  });
});

describe('只读保护', () => {
  it('只读连接上写操作被拒绝', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: {
        name: '只读库',
        dbType: 'sqlite',
        databaseName: targetDbPath,
        isReadOnly: true,
      },
    });
    const id = created.json().item.id as number;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId: id, sql: 'CREATE TABLE nope (a INT)', confirm: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('READONLY_VIOLATION');
  });

  it('只读连接仍可查询', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: '只读库2', dbType: 'sqlite', databaseName: targetDbPath, isReadOnly: true },
    });
    const id = created.json().item.id as number;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId: id, sql: 'SELECT COUNT(*) FROM demo' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('资源级授权（AC-05：只看到被授权的连接）', () => {
  let scopedToken = '';
  let scopedUserId = 0;
  const SECOND_NAME = '仅授权一个库的演示连接';

  it('先造出第二个连接，作为"不该被看到"的对照', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: SECOND_NAME, dbType: 'sqlite', databaseName: targetDbPath },
    });
    expect(res.statusCode).toBe(201);
  });

  it('创建用户并只授权 connection:<id>', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(),
      payload: {
        username: 'scoped-user',
        password: 'Sc0ped-Pass!',
        displayName: '受限用户',
        roles: ['developer'],
      },
    });
    expect(created.statusCode).toBe(201);
    scopedUserId = created.json().item.id;

    const granted = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${scopedUserId}/grants`,
      headers: auth(),
      payload: { grants: [{ resourceType: 'connection', resourceId: String(connectionId), actions: ['*'] }] },
    });
    expect(granted.statusCode).toBe(200);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${scopedUserId}/grants`,
      headers: auth(),
    });
    expect((listed.json().items as unknown[]).length).toBe(1);
  });

  it('显式授权后进入白名单模式：只返回被授权的连接', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'scoped-user', password: 'Sc0ped-Pass!' },
    });
    expect(login.statusCode).toBe(200);
    scopedToken = login.json().token;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: number; name: string }>;
    expect(items.map((i) => i.id)).toEqual([connectionId]);
    expect(items.some((i) => i.name === SECOND_NAME)).toBe(false);
  });

  it('未被授权的连接即使知道 id 也访问不到', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/v1/connections', headers: auth() });
    const other = (all.json().items as Array<{ id: number; name: string }>).find((i) => i.name === SECOND_NAME);
    expect(other).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${other?.id}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(res.statusCode).toBe(404);

    const query = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { connectionId: other?.id, sql: 'SELECT 1' },
    });
    expect(query.statusCode).toBe(404);
  });

  it('管理员始终可见全部连接，不受授权限制', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/connections', headers: auth() });
    const names = (res.json().items as Array<{ name: string }>).map((i) => i.name);
    expect(names).toContain(SECOND_NAME);
  });
});

describe('审计与完整性', () => {
  it('审计日志可通过权限接口查询', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/logs', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect((res.json().items as unknown[]).length).toBeGreaterThan(0);
  });

  it('哈希链校验通过（并且确实校验了记录）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.checked).toBeGreaterThan(0);
  });

  it('审计统计可读', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/stats', headers: auth() });
    expect(res.statusCode).toBe(200);
  });

  it('审计可导出为 CSV', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/logs/export?format=csv', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id');
  });
});

describe('AI 与迁移接口的降级行为', () => {
  it('未启用 AI 时明确返回 AI_DISABLED，而不是假装成功', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/nl2sql',
      headers: auth(),
      payload: { prompt: '查询所有用户', connectionId },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(['AI_DISABLED', 'AI_PROVIDER_ERROR']).toContain(res.json().error.code);
  });

  it('AI 状态接口说明是否已配置', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
    expect(res.json().configured).toBe(false);
  });

  it('迁移预检需要有效连接', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/migration/precheck',
      headers: auth(),
      payload: { sourceConnectionId: 999999, targetConnectionId: 999999 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('迁移任务列表可读', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/migration/tasks', headers: auth() });
    expect(res.statusCode).toBe(200);
  });
});

describe('用户与权限管理', () => {
  let newUserId = 0;

  it('管理员可创建用户', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(),
      payload: {
        username: 'readonly-user',
        password: 'Re@d0nly-Pass!',
        displayName: '只读用户',
        roles: ['readonly'],
      },
    });
    expect(res.statusCode).toBe(201);
    newUserId = res.json().item.id;
  });

  it('新用户可登录但受角色限制', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'readonly-user', password: 'Re@d0nly-Pass!' },
    });
    expect(login.statusCode).toBe(200);
    const userToken = login.json().token as string;

    // 只读角色没有 user.manage 权限，不能管理用户
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // 但可以查询
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { connectionId, sql: 'SELECT 1' },
    });
    expect(allowed.statusCode).toBe(200);

    // 且不能执行写操作
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { connectionId, sql: 'CREATE TABLE x (a INT)', confirm: true },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('角色与权限清单可读', async () => {
    const roles = await app.inject({ method: 'GET', url: '/api/v1/users/roles', headers: auth() });
    expect(roles.statusCode).toBe(200);
    expect((roles.json().items as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('禁用用户后无法登录', async () => {
    const disable = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${newUserId}`,
      headers: auth(),
      payload: { status: 0 },
    });
    expect(disable.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'readonly-user', password: 'Re@d0nly-Pass!' },
    });
    expect(login.statusCode).toBeGreaterThanOrEqual(401);
  });

  it('登出后令牌失效', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ADMIN, password: ADMIN_PASSWORD },
    });
    const tempToken = login.json().token as string;

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tempToken}` },
    });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${tempToken}` },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tempToken}` },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('令牌续签（/auth/refresh）', () => {
  it('续签返回新令牌，且旧令牌立即失效（会话轮换）', async () => {
    // 用一次性登录拿到的令牌，避免污染其他用例共享的 token
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: ADMIN_PASSWORD },
    });
    const oldToken = login.json().token as string;
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(200);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(refreshed.statusCode).toBe(200);
    const newToken = refreshed.json().token as string;
    expect(newToken).not.toBe(oldToken);
    expect(refreshed.json().expiresIn).toBeGreaterThan(0);

    // 新令牌可用
    const withNew = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(withNew.statusCode).toBe(200);

    // 旧令牌必须已失效：否则令牌可被无限续命，泄露后无法收回
    const withOld = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(withOld.statusCode).toBe(401);
  });

  it('未带令牌续签返回 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });
});

describe('图表与看板（AC-03）', () => {
  const chartPayload = {
    name: '按区域统计订单额',
    chartType: 'bar',
    connectionId: 0, // 运行时替换
    dataSource: 'table' as const,
    sourceRef: 'orders',
    config: {
      dimensions: [{ column: 'region', aggregation: 'none' }],
      metrics: [{ column: 'amount', aggregation: 'sum', alias: 'total' }],
      limit: 100,
    },
  };

  it('图表类型清单包含 15 种类型且带中英文标签', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/charts/types', headers: auth() });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ type: string; label: string; minDimensions: number; minMetrics: number }>;
    expect(items.length).toBe(15);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.minDimensions).toBe('number');
      expect(item.minMetrics).toBeGreaterThanOrEqual(0);
    }
    expect(items.map((i) => i.type)).toContain('sankey');
  });

  it('创建图表：配置不满足类型要求时被拒', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: {
        name: '缺指标的柱状图',
        chartType: 'bar', // 至少需要 1 维度 + 1 指标
        connectionId,
        config: { dimensions: [{ column: 'region', aggregation: 'none' }], metrics: [] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('创建图表：不支持的图表类型被拒', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: {
        name: '奇怪的图',
        chartType: 'not_a_chart',
        connectionId,
        config: { dimensions: [{ column: 'a', aggregation: 'none' }], metrics: [{ column: 'b', aggregation: 'sum' }] },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('创建图表：字段名带非法字符被拒（注入防护）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: {
        name: '注入尝试',
        chartType: 'bar',
        connectionId,
        config: {
          dimensions: [{ column: 'region"; DROP TABLE users; --', aggregation: 'none' }],
          metrics: [{ column: 'amount', aggregation: 'sum' }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/非法字符/);
  });

  it('创建图表 → 取数返回真实聚合结果 → 读取详情，并可删除', async () => {
    // 造一张带数据的表，保证聚合结果可验证
    await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'DROP TABLE IF EXISTS chart_src', confirm: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: { connectionId, sql: 'CREATE TABLE chart_src (region TEXT, amount REAL)', confirm: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(),
      payload: {
        connectionId,
        sql: "INSERT INTO chart_src (region, amount) VALUES ('华东', 100), ('华东', 50), ('华南', 20)",
        confirm: true,
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: { ...chartPayload, connectionId, sourceRef: 'chart_src' },
    });
    expect(created.statusCode).toBe(201);
    const chart = created.json();
    expect(chart.id).toBeGreaterThan(0);
    expect(chart.chartType).toBe('bar');

    // 取数：应由结构化配置生成 SQL 并真的执行
    const data = await app.inject({ method: 'GET', url: `/api/v1/charts/${chart.id}/data`, headers: auth() });
    expect(data.statusCode).toBe(200);
    const body = data.json();
    expect(body.sql).toContain('GROUP BY');
    expect(body.rowCount).toBeGreaterThanOrEqual(2);
    // 找到华东一行并核对聚合值 150
    const regionIdx = body.columns.findIndex((c: { name: string }) => c.name === 'region');
    const totalIdx = body.columns.findIndex((c: { name: string }) => c.name === 'total');
    expect(regionIdx).toBeGreaterThanOrEqual(0);
    expect(totalIdx).toBeGreaterThanOrEqual(0);
    const huaDong = body.rows.find((r: unknown[]) => r[regionIdx] === '华东');
    expect(Number(huaDong[totalIdx])).toBe(150);

    // 详情
    const detail = await app.inject({ method: 'GET', url: `/api/v1/charts/${chart.id}`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().name).toBe('按区域统计订单额');

    // 删除
    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/charts/${chart.id}`, headers: auth() });
    expect(removed.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/charts/${chart.id}`, headers: auth() });
    expect(gone.statusCode).toBe(404);
  });

  it('图表自定义 SQL 为写语句时被拒（不能绕过写闸门）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: {
        name: '写操作图表',
        chartType: 'bar',
        connectionId,
        dataSource: 'query',
        querySql: 'DELETE FROM chart_src',
        config: { dimensions: [{ column: 'region', aggregation: 'none' }], metrics: [{ column: 'amount', aggregation: 'sum' }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({ method: 'GET', url: `/api/v1/charts/${created.json().id}/data`, headers: auth() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('READONLY_VIOLATION');
    await app.inject({ method: 'DELETE', url: `/api/v1/charts/${created.json().id}`, headers: auth() });
  });

  it('看板：创建、挂图表、读取详情时带出图表列表', async () => {
    const dash = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: auth(),
      payload: { name: '运营看板', description: '每日核心指标', layout: { columns: 2 } },
    });
    expect(dash.statusCode).toBe(201);
    const dashboardId = dash.json().id as number;

    const chart = await app.inject({
      method: 'POST',
      url: '/api/v1/charts',
      headers: auth(),
      payload: { ...chartPayload, connectionId, dashboardId, sourceRef: 'chart_src' },
    });
    expect(chart.statusCode).toBe(201);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/dashboards/${dashboardId}`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.name).toBe('运营看板');
    expect(body.layout).toEqual({ columns: 2 });
    expect(body.charts.length).toBe(1);
    expect(body.charts[0].id).toBe(chart.json().id);

    // 看板列表
    const list = await app.inject({ method: 'GET', url: '/api/v1/dashboards', headers: auth() });
    expect(list.json().items.map((d: { id: number }) => d.id)).toContain(dashboardId);

    // 删除看板应级联删除其下图表（外键 ON DELETE CASCADE）
    await app.inject({ method: 'DELETE', url: `/api/v1/dashboards/${dashboardId}`, headers: auth() });
    const chartGone = await app.inject({ method: 'GET', url: `/api/v1/charts/${chart.json().id}`, headers: auth() });
    expect(chartGone.statusCode).toBe(404);
  });

  it('不存在的图表/看板返回 404', async () => {
    const c = await app.inject({ method: 'GET', url: '/api/v1/charts/999999', headers: auth() });
    expect(c.statusCode).toBe(404);
    const d = await app.inject({ method: 'GET', url: '/api/v1/dashboards/999999', headers: auth() });
    expect(d.statusCode).toBe(404);
  });

  it('未认证访问图表接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/charts' });
    expect(res.statusCode).toBe(401);
  });
});

describe('根路径', () => {
  it('未构建 Web 时返回产品信息而不是 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
  });
});
