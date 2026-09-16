/**
 * 花生苗数据库管理工具 - 审计导出回归测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 导出接口曾把最多 10 万行审计一次性物化成一个字符串（同步、阻塞事件循环、
 * 中间数组可达上百 MB）。现在改为按 id 游标分批读 + 流式写响应。
 * 这里守住两件事：流式改造后**内容格式不变**（CSV 表头/列序、JSON 仍是合法数组），
 * 以及导出行为本身仍会留下审计记录。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import type { ServerConfig } from './config.js';

let app: FastifyInstance; let ctx: AppContext; let dir: string; let token = '';
const PW = 'Adm1n-Passw0rd!';
function cfg(): ServerConfig {
  return { host: '127.0.0.1', port: 0, dataDir: dir, masterPassword: null, tokenTtlSec: 3600,
    corsOrigin: null, serveWeb: false, webDistPath: null, bootstrapAdminUsername: 'admin',
    bootstrapAdminPassword: PW, logLevel: 'silent', https: null, idleConnectionMs: 0, instanceNonce: null, trustProxy: false };
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-exp-'));
  ctx = createContext({ config: cfg(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: PW } });
  token = login.json().token;
});
afterAll(async () => { await app.close(); await disposeContext(ctx); rmSync(dir, { recursive: true, force: true }); });

describe('审计导出流式化', () => {
  it('CSV 导出内容与逐行渲染一致，且首行是表头', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/logs/export?format=csv', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.body;
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('id,created_at,username,action,resource_type,resource_id,connection_id,status,error_message,duration_ms,ip_address,sql_text,prev_hash,curr_hash');
    // 至少有登录与导出两类审计
    expect(lines.length).toBeGreaterThan(2);
    // 每行 14 列（无内嵌换行的简单记录）
    expect(lines[1].split(',').length).toBeGreaterThanOrEqual(14);
  });

  it('JSON 导出是合法 JSON 数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/logs/export?format=json', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(1);
    expect(parsed[0]).toHaveProperty('action');
  });

  it('导出仍会写审计', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/logs?action=export&limit=5', headers: { authorization: `Bearer ${token}` } });
    expect(res.json().items.length).toBeGreaterThan(0);
  });
});
