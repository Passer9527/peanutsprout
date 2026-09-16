/**
 * 花生苗数据库管理工具 - MySQL 连接层行为测试（假连接池）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本机没有可用的 MySQL 服务端（集成用例按环境跳过），但驱动的连接处置逻辑
 * 必须被真正验证：超时丢弃连接、只读连接用事务级只读兜底。
 */

import type { ConnectionConfig } from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import {
  MysqlConnection,
  type MysqlConnLike,
  type MysqlPoolLike,
} from './mysql.js';

type MysqlResult = Awaited<ReturnType<MysqlConnLike['query']>>;

const ONE_ROW: MysqlResult = [[[1]], [{ name: 'v', type: 3 }]];
const OK: MysqlResult = [{ affectedRows: 1 }, []];

class FakeMysqlConn implements MysqlConnLike {
  readonly queries: string[] = [];
  released = false;
  destroyed = false;

  async query(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<MysqlResult> {
    this.queries.push(options.sql);
    if (options.sql.includes('SLOW')) return await new Promise<MysqlResult>(() => undefined);
    if (options.sql === 'START TRANSACTION READ ONLY' || options.sql === 'ROLLBACK') return [{}, []];
    if (/^\s*(insert|update|delete|create|drop)/i.test(options.sql)) {
      // 模拟 MySQL：只读事务里的写操作被数据库层拒绝
      throw Object.assign(new Error('Cannot execute statement in a READ ONLY transaction.'), {
        code: 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION',
      });
    }
    return options.rowsAsArray ? ONE_ROW : OK;
  }

  async execute(options: { sql: string; values?: unknown[]; rowsAsArray?: boolean }): Promise<MysqlResult> {
    return await this.query(options);
  }

  async end(): Promise<void> {
    /* noop */
  }

  destroy(): void {
    this.destroyed = true;
  }

  release(): void {
    this.released = true;
  }
}

function fakePool(): { pool: MysqlPoolLike; conns: FakeMysqlConn[] } {
  const conns: FakeMysqlConn[] = [];
  return {
    conns,
    pool: {
      query: async () => ONE_ROW,
      execute: async () => ONE_ROW,
      getConnection: async () => {
        const conn = new FakeMysqlConn();
        conns.push(conn);
        return conn;
      },
      end: async () => undefined,
    },
  };
}

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'fake-mysql',
    dbType: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    databaseName: 'demo',
    username: 'root',
    password: '',
    readOnly: false,
    ...overrides,
  } as ConnectionConfig;
}

describe('MySQL 查询超时（回归缺陷：超时被忽略、脏连接回池）', () => {
  it('超时抛 QUERY_TIMEOUT 并 destroy 该连接', async () => {
    const { pool, conns } = fakePool();
    const conn = new MysqlConnection('my-1', config(), pool, null);

    await expect(conn.getQueryExecutor().execute('SELECT SLOW', { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'QUERY_TIMEOUT',
    });
    expect(conns[0]?.destroyed).toBe(true);
    expect(conns[0]?.released).toBe(false);
  });

  it('超时后的下一次查询使用新连接', async () => {
    const { pool, conns } = fakePool();
    const conn = new MysqlConnection('my-2', config(), pool, null);

    await expect(conn.getQueryExecutor().execute('SELECT SLOW', { timeoutMs: 20 })).rejects.toThrow();
    const res = await conn.getQueryExecutor().execute('SELECT 1', { timeoutMs: 500 });

    expect(res.rows[0]?.[0]).toBe(1);
    expect(conns).toHaveLength(2);
    expect(conns[1]?.released).toBe(true);
  });
});

describe('MySQL 只读连接（回归缺陷：只读保护未在驱动层生效）', () => {
  it('executeUpdate 绕过应用层判定，仍在只读事务里被拒绝并回滚', async () => {
    const { pool, conns } = fakePool();
    const conn = new MysqlConnection('my-3', config({ readOnly: true }), pool, null);

    await expect(conn.getQueryExecutor().executeUpdate('INSERT INTO t VALUES (1)')).rejects.toThrow();

    const used = conns[0];
    expect(used?.queries[0]).toBe('START TRANSACTION READ ONLY');
    expect(used?.queries).toContain('ROLLBACK');
    expect(used?.destroyed).toBe(false);
  });

  it('只读连接上的 SELECT 正常返回，且包在只读事务里', async () => {
    const { pool, conns } = fakePool();
    const conn = new MysqlConnection('my-4', config({ readOnly: true }), pool, null);

    const res = await conn.getQueryExecutor().execute('SELECT 1');
    expect(res.rows[0]?.[0]).toBe(1);
    expect(conns[0]?.queries).toEqual(['START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK']);
  });
});
