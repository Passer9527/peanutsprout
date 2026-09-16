/**
 * 花生苗数据库管理工具 - 「局域网访问」端到端测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个开关是**安全边界**，所以断言的重点不只是"功能能用"，还包括：
 *  · 没有 settings.manage 权限的人改不了、也读不到；
 *  · 保存 ≠ 生效，接口必须如实区分（否则界面会显示"已开启"而实际连不上，
 *    用户把网址发给同事、对方打不开，却查不出原因）；
 *  · 绝不把 0.0.0.0 这种没法访问的地址回给界面。
 *
 * 测试配置里 host/port 都取自默认值（config.host='127.0.0.1'、port=0），
 * 相当于一个"部署方未显式指定监听地址"的普通部署 —— 此时界面开关生效。
 * 桌面端走的是相反路径（显式传入 host/port），由 apps/desktop 的测试覆盖。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import type { ServerConfig } from './config.js';

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let adminToken = '';
let readonlyToken = '';

const ADMIN = 'admin';
// 用非默认口令引导：默认口令会触发"强制改密"闸门，并让 default_password 提示恒为真，
// 那样就分不清"提示来自开关"还是"来自初始口令"了。
const ADMIN_PASSWORD = 'Adm1n-Passw0rd!';
const READONLY_PASSWORD = 'Re@d0nly-Pass!';

function testConfig(): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    masterPassword: null,
    tokenTtlSec: 3600,
    corsOrigin: null,
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

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

interface WebAccessBody {
  saved: { lanEnabled: boolean; lanPort: number };
  effective: { lanEnabled: boolean; host: string; port: number; scheme: string };
  restartRequired: boolean;
  urls: string[];
  lanAddresses: string[];
  warnings: string[];
  embedded: boolean;
}

async function getWebAccess(token = adminToken): Promise<WebAccessBody> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/meta/web-access',
    headers: auth(token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as WebAccessBody;
}

async function putSettings(
  items: Array<{ key: string; value: string | number | boolean }>,
  token = adminToken,
) {
  return app.inject({
    method: 'PUT',
    url: '/api/v1/meta/settings',
    headers: auth(token),
    payload: { items },
  });
}

/** 每个用例前把开关恢复成初始状态，避免用例之间互相影响 */
async function resetWebSettings(): Promise<void> {
  const res = await putSettings([
    { key: 'web.lan_enabled', value: false },
    { key: 'web.lan_port', value: 8787 },
  ]);
  expect(res.statusCode, res.body).toBe(200);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-webaccess-'));
  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  const adminLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: ADMIN, password: ADMIN_PASSWORD },
  });
  expect(adminLogin.statusCode, adminLogin.body).toBe(200);
  adminToken = adminLogin.json().token as string;

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(adminToken),
    payload: { username: 'wa-readonly', password: READONLY_PASSWORD, roles: ['readonly'] },
  });
  expect(created.statusCode, created.body).toBe(201);

  const readonlyLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'wa-readonly', password: READONLY_PASSWORD },
  });
  expect(readonlyLogin.statusCode, readonlyLogin.body).toBe(200);
  readonlyToken = readonlyLogin.json().token as string;
});

afterAll(async () => {
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /meta/web-access 的访问控制', () => {
  it('未登录一律 401，不泄漏任何监听信息', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/web-access' });
    expect(res.statusCode).toBe(401);
    // 连"有没有开"都不该透露
    expect(res.body).not.toContain('lanEnabled');
  });

  it('没有 settings.manage 的角色读不到（403）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meta/web-access',
      headers: auth(readonlyToken),
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('只读角色也改不了这个开关（403，而不是静默忽略）', async () => {
    await resetWebSettings();
    const res = await putSettings([{ key: 'web.lan_enabled', value: true }], readonlyToken);
    expect(res.statusCode, res.body).toBe(403);
    // 确认没有被偷偷写进去
    expect((await getWebAccess()).saved.lanEnabled).toBe(false);
  });
});

describe('默认状态', () => {
  it('初始为关闭，只监听回环，且没有任何风险提示', async () => {
    await resetWebSettings();
    const body = await getWebAccess();

    expect(body.saved).toEqual({ lanEnabled: false, lanPort: 8787 });
    expect(body.effective.lanEnabled).toBe(false);
    expect(body.effective.scheme).toBe('http');
    expect(body.restartRequired).toBe(false);
    // 关闭时不给局域网地址：给了也没用，只会让人误以为能访问
    expect(body.urls).toEqual([`http://127.0.0.1:${body.effective.port}`]);
    // 只绑回环还要提示"记得改口令"属于噪音
    expect(body.warnings).toEqual([]);
  });

  it('回给界面的 host 永远不是通配地址', async () => {
    await putSettings([{ key: 'web.lan_enabled', value: true }]);
    const body = await getWebAccess();
    // 0.0.0.0 贴到界面上用户没法访问，必须换成可读地址
    expect(body.effective.host).not.toBe('0.0.0.0');
    expect(body.effective.host).toBe('127.0.0.1');
    // 但"确实对局域网开放了"这件事不能因此被掩盖
    expect(body.saved.lanEnabled).toBe(true);
    await resetWebSettings();
  });
});

describe('保存与生效的区分', () => {
  it('打开开关后：保存值变了，但本次进程仍是回环，并提示需重启', async () => {
    await resetWebSettings();
    const res = await putSettings([{ key: 'web.lan_enabled', value: true }]);
    expect(res.statusCode, res.body).toBe(200);

    const body = await getWebAccess();
    expect(body.saved.lanEnabled).toBe(true);
    // 绑定地址在 listen 之前就定了，改设置不可能立刻生效
    expect(body.effective.lanEnabled).toBe(false);
    expect(body.restartRequired).toBe(true);
  });

  it('打开后立即给出风险提示（含 HTTP 明文）', async () => {
    await putSettings([{ key: 'web.lan_enabled', value: true }]);
    const body = await getWebAccess();
    expect(body.warnings).toContain('lan_exposed');
    // 测试配置没开 https
    expect(body.warnings).toContain('no_https');
  });

  it('改端口后保存值更新，同样提示需重启', async () => {
    await putSettings([
      { key: 'web.lan_enabled', value: true },
      { key: 'web.lan_port', value: 9123 },
    ]);
    const body = await getWebAccess();
    expect(body.saved.lanPort).toBe(9123);
    expect(body.restartRequired).toBe(true);
  });

  it('改回关闭后不再提示需重启之外的风险', async () => {
    await resetWebSettings();
    const body = await getWebAccess();
    expect(body.saved.lanEnabled).toBe(false);
    expect(body.warnings).toEqual([]);
  });
});

describe('取值校验', () => {
  it('端口越界被拒（整数约束来自存储层白名单）', async () => {
    await resetWebSettings();
    for (const bad of [80, 0, 65536, 99999]) {
      const res = await putSettings([{ key: 'web.lan_port', value: bad }]);
      expect(res.statusCode, `端口 ${bad} 应被拒绝: ${res.body}`).toBe(400);
    }
    // 全部失败后原值不受影响（setManyValidated 是整体事务）
    expect((await getWebAccess()).saved.lanPort).toBe(8787);
  });

  it('端口为非整数/脏值被拒', async () => {
    const res = await putSettings([{ key: 'web.lan_port', value: 'abc' }]);
    expect(res.statusCode, res.body).toBe(400);
  });

  it('布尔开关的取值契约：接受真布尔值与 "true"/"false"，拒绝其它写法', async () => {
    // 与存储层 setValidated 的实际行为对齐：boolean 型接受 true/false 或
    // 恰好等于 'true'/'false' 的字符串，其余（数字、"1"、"yes"）一律拒绝。
    // 之所以要把这条钉住：读取端（含桌面端那份零依赖复刻）只认 'true'/'1'，
    // 若写入端哪天开始放行 'yes'，就会存进一个谁也读不懂的值。
    for (const bad of [1, 0, '1', 'yes', 'on', null]) {
      const res = await putSettings([{ key: 'web.lan_enabled', value: bad as never }]);
      expect(res.statusCode, `值 ${String(bad)} 应被拒绝: ${res.body}`).toBe(400);
    }
    // 字符串 'true' 被显式接受（前端表单可能以字符串提交）
    const ok = await putSettings([{ key: 'web.lan_enabled', value: 'true' }]);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await getWebAccess()).saved.lanEnabled).toBe(true);
    await resetWebSettings();
  });

  it('两个键都在可写白名单里（界面据此渲染）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meta/settings/writable',
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items as Array<{ key: string; type: string; min?: number; max?: number }>;
    const enabled = items.find((item) => item.key === 'web.lan_enabled');
    const port = items.find((item) => item.key === 'web.lan_port');
    expect(enabled, 'web.lan_enabled 应在白名单中').toBeDefined();
    expect(enabled?.type).toBe('boolean');
    expect(port, 'web.lan_port 应在白名单中').toBeDefined();
    expect(port?.type).toBe('integer');
    expect(port?.min).toBe(1024);
    expect(port?.max).toBe(65535);
  });

  it('改动被写入审计（含键名，否则事后无法追溯谁开了外网）', async () => {
    await resetWebSettings();
    await putSettings([{ key: 'web.lan_enabled', value: true }]);
    const rows = ctx.pdb.audit.query({ limit: 50 }).items;
    const hit = rows.find(
      (row) => row.action === 'settings_update' && row.resourceId === 'web.lan_enabled',
    );
    expect(hit, '未找到 web.lan_enabled 的审计记录').toBeDefined();
    expect(hit?.detail).toContain('web.lan_enabled');
    await resetWebSettings();
  });
});
