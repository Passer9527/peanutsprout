/**
 * 花生苗数据库管理工具 - PostgreSQL 连通性探测测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 单独成文件的原因：PGLiteSocketServer 一生只服务一个客户端连接，
 * 而 testConnection 会自己建立再关闭一条连接，所以它必须独占一个服务端实例。
 * 这里同时验证成功路径与失败路径（端口不通时必须返回 ok:false 而不是抛异常）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '@peanutsprout/core';
import { PostgresDriver } from './postgresql.js';

async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * PGlite 的 socket 服务端在断开客户端时，会把自己的清理回调丢进 setImmediate，
 * 该回调最终会调用 pglite.isInTransaction()。如果我们在它跑完之前就 close() 了
 * PGlite 实例，就会抛 "Cannot read properties of undefined (reading
 * '_IsTransactionBlock')" 的未处理拒绝（第三方库的时序缺陷，不是产品代码问题）。
 * 因此统一遵循：先断开并停掉服务端 → 留出一个事件循环让清理回调跑完 → 再关闭 PGlite。
 */
async function drainPgliteCallbacks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

let port = 0;
let db: { close(): Promise<void> } | null = null;
let server: { stop(): Promise<void> } | null = null;

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 2,
    name: 'pglite-conn-test',
    dbType: 'postgresql',
    host: '127.0.0.1',
    port,
    databaseName: 'postgres',
    username: 'postgres',
    password: '',
    readOnly: false,
    ...overrides,
  };
}

beforeAll(async () => {
  port = await freePort();
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const instance = await PGlite.create();
  const srv = new PGLiteSocketServer({ db: instance, port, host: '127.0.0.1' });
  await srv.start();
  db = instance as unknown as { close(): Promise<void> };
  server = srv as unknown as { stop(): Promise<void> };
}, 180_000);

afterAll(async () => {
  await server?.stop().catch(() => undefined);
  await drainPgliteCallbacks();
  await db?.close().catch(() => undefined);
}, 60_000);

describe('PostgreSQL testConnection', () => {
  it('连通时返回真实服务端版本号', async () => {
    const result = await new PostgresDriver().testConnection(config());
    expect(result.ok).toBe(true);
    expect(result.serverVersion?.toLowerCase()).toContain('postgresql');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('端口不通时返回 ok:false 并带可读原因，而不是抛异常', async () => {
    const dead = await freePort(); // 拿到一个没人监听的端口
    const result = await new PostgresDriver().testConnection(config({ port: dead }));
    expect(result.ok).toBe(false);
    expect(result.serverVersion).toBeNull();
    expect(result.message.length).toBeGreaterThan(0);
  }, 60_000);
});
