/**
 * 花生苗数据库管理工具 - PostgreSQL 连接层行为测试（假连接池）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这里用假连接池精确观察驱动的连接处置：
 *  · 查询超时后必须 `release(true)` 丢弃连接，而不是还回池里；
 *  · 只读连接必须在只读事务里执行（数据库层兜底），即使 executeUpdate
 *    完全绕过了应用层的 isWriteStatement 判定。
 * 真实数据库层的拒绝验证见 postgresql-extra.test.ts。
 */

import type { ConnectionConfig } from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import {
  PostgresConnection,
  type PgClientLike,
  type PgPoolLike,
} from './postgresql.js';

type PgResult = Awaited<ReturnType<PgClientLike['query']>>;

const EMPTY: PgResult = { fields: [], rows: [], rowCount: null };
const ONE_ROW: PgResult = { fields: [{ name: 'v', dataTypeID: 23 }], rows: [[1]], rowCount: 1 };

class FakePgClient implements PgClientLike {
  readonly queries: string[] = [];
  releases: Array<Error | boolean | undefined> = [];
  destroyed = false;

  async query(config: { text: string; values?: unknown[]; rowMode?: string }): Promise<PgResult> {
    this.queries.push(config.text);
    if (config.text.includes('SLOW')) return await new Promise<PgResult>(() => undefined);
    if (config.text === 'BEGIN READ ONLY' || config.text === 'ROLLBACK') return EMPTY;
    if (/^\s*(insert|update|delete|create|drop)/i.test(config.text)) {
      const err = Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' });
      throw err;
    }
    return ONE_ROW;
  }

  release(err?: Error | boolean): void {
    this.releases.push(err);
    if (err === true) this.destroyed = true;
  }

  async end(): Promise<void> {
    /* noop */
  }
}

function fakePool(): { pool: PgPoolLike; clients: FakePgClient[] } {
  const clients: FakePgClient[] = [];
  return {
    clients,
    pool: {
      connect: async () => {
        const client = new FakePgClient();
        clients.push(client);
        return client;
      },
      query: async () => ONE_ROW,
      end: async () => undefined,
    },
  };
}

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'fake-pg',
    dbType: 'postgresql',
    host: '127.0.0.1',
    port: 5432,
    databaseName: 'postgres',
    username: 'postgres',
    password: '',
    readOnly: false,
    ...overrides,
  } as ConnectionConfig;
}

describe('PostgreSQL 查询超时（回归缺陷：超时被忽略、脏连接回池）', () => {
  it('超时抛 QUERY_TIMEOUT，并以 release(true) 丢弃该连接', async () => {
    const { pool, clients } = fakePool();
    const conn = new PostgresConnection('pg-1', config(), pool, null);

    await expect(conn.getQueryExecutor().execute('SELECT SLOW', { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'QUERY_TIMEOUT',
    });

    const used = clients[0];
    expect(used?.destroyed).toBe(true);
    expect(used?.releases).toContain(true);
  });

  it('超时后的下一次查询会换一条干净连接，不复用被超时的连接', async () => {
    const { pool, clients } = fakePool();
    const conn = new PostgresConnection('pg-2', config(), pool, null);

    await expect(conn.getQueryExecutor().execute('SELECT SLOW', { timeoutMs: 20 })).rejects.toThrow();
    const res = await conn.getQueryExecutor().execute('SELECT 1', { timeoutMs: 500 });

    expect(res.rows[0]?.[0]).toBe(1);
    expect(clients).toHaveLength(2);
    expect(clients[0]?.destroyed).toBe(true);
    expect(clients[1]?.destroyed).toBe(false);
    expect(clients[1]?.releases).toContain(undefined);
  });
});

describe('PostgreSQL 只读连接（回归缺陷：只读保护未在驱动层生效）', () => {
  it('executeUpdate 绕过应用层判定，仍在只读事务里执行并回滚', async () => {
    const { pool, clients } = fakePool();
    const conn = new PostgresConnection('pg-3', config({ readOnly: true }), pool, null);

    // executeUpdate 不做 isWriteStatement 检查，直接下发 SQL —— 唯一能拦住它的
    // 就是驱动在数据库层开的只读事务
    await expect(conn.getQueryExecutor().executeUpdate('INSERT INTO t VALUES (1)')).rejects.toThrow();

    const used = clients[0];
    expect(used?.queries[0]).toBe('BEGIN READ ONLY');
    expect(used?.queries).toContain('ROLLBACK');
    // 事务已回滚，连接是干净的，应正常归还而不是销毁
    expect(used?.destroyed).toBe(false);
  });

  it('只读连接上的普通查询照常返回，且包在只读事务里', async () => {
    const { pool, clients } = fakePool();
    const conn = new PostgresConnection('pg-4', config({ readOnly: true }), pool, null);

    const res = await conn.getQueryExecutor().execute('SELECT 1');
    expect(res.rows[0]?.[0]).toBe(1);
    expect(clients[0]?.queries).toEqual(['BEGIN READ ONLY', 'SELECT 1', 'ROLLBACK']);
  });

  it('只读事务里查询超时：回滚并销毁该连接', async () => {
    const { pool, clients } = fakePool();
    const conn = new PostgresConnection('pg-5', config({ readOnly: true }), pool, null);

    await expect(conn.getQueryExecutor().execute('SELECT SLOW', { timeoutMs: 20 })).rejects.toThrow();
    expect(clients[0]?.destroyed).toBe(true);
  });
});
