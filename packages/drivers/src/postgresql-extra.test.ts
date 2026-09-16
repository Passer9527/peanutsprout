/**
 * 花生苗数据库管理工具 - PostgreSQL 真实服务端行为测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖四类回归缺陷（全部对接真实 PG 服务端，PGlite 通过 socket 暴露标准线协议）：
 *  1. date / timestamp without time zone 被 toISOString() 按本地时区平移；
 *  2. maxRows 限行被字符串/注释绕过、truncated 误报；
 *  3. 只读连接缺少数据库层兜底；
 *  4. 表达式索引（lower(email)）被当成列名，拼出非法 DDL。
 *
 * TZ 固定为 Asia/Shanghai（东八区），这样"按本地时区平移"的旧行为必然暴露。
 */

process.env.TZ = 'Asia/Shanghai';

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

let port = 0;
let db: { close(): Promise<void> } | null = null;
let server: { stop(): Promise<void> } | null = null;
let shared: Awaited<ReturnType<PostgresDriver['connect']>> | null = null;
let readOnlyConn: Awaited<ReturnType<PostgresDriver['connect']>> | null = null;

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'pglite-extra',
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

async function drainPgliteCallbacks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

beforeAll(async () => {
  port = await freePort();
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const instance = await PGlite.create();
  // 本文件要同时开普通连接与只读连接，必须放开单连接限制
  const srv = new PGLiteSocketServer({ db: instance, port, host: '127.0.0.1', maxConnections: 8 });
  await srv.start();
  db = instance as unknown as { close(): Promise<void> };
  server = srv as unknown as { stop(): Promise<void> };
  shared = await new PostgresDriver().connect(config());
  readOnlyConn = await new PostgresDriver().connect(config({ id: 2, readOnly: true }));
}, 180_000);

afterAll(async () => {
  await shared?.close().catch(() => undefined);
  await readOnlyConn?.close().catch(() => undefined);
  await server?.stop().catch(() => undefined);
  await drainPgliteCallbacks();
  await db?.close().catch(() => undefined);
}, 60_000);

describe('date / timestamp 时区语义（回归缺陷：toISOString 按本地时区平移）', () => {
  it('前提：进程时区确实是 Asia/Shanghai（UTC+8）', () => {
    expect(new Date(2024, 0, 15).getTimezoneOffset()).toBe(-480);
  });

  it('DATE 原样返回，不再被平移', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared.getQueryExecutor().execute("SELECT DATE '2024-01-15' AS d");
    const broken = new Date(2024, 0, 15).toISOString();
    // 旧实现会给到 2024-01-14T16:00:00.000Z（前一天的本地零点），这是静默数据损坏
    expect(broken).toBe('2024-01-14T16:00:00.000Z');
    expect(res.rows[0]?.[0]).toBe('2024-01-15');
    expect(res.rows[0]?.[0]).not.toBe(broken);
  });

  it('timestamp without time zone 原样返回', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared
      .getQueryExecutor()
      .execute("SELECT TIMESTAMP '2024-01-15 12:30:00' AS ts");
    expect(res.rows[0]?.[0]).toBe('2024-01-15 12:30:00');
    expect(res.rows[0]?.[0]).not.toBe(new Date(2024, 0, 15, 12, 30, 0).toISOString());
  });

  it('timestamptz 仍返回绝对时刻（带时区列不退化）', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared
      .getQueryExecutor()
      .execute("SELECT TIMESTAMPTZ '2024-01-15 12:30:00+08:00' AS tstz");
    const expected = new Date('2024-01-15T12:30:00+08:00').toISOString();
    expect(res.rows[0]?.[0]).toBe(expected);
    expect(res.columns[0]?.dataType).toBe('timestamptz');
  });

  it('建表写入后读回：date / timestamp 不失真，timestamptz 绝对时刻一致', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const exec = shared.getQueryExecutor();
    await exec.execute('DROP TABLE IF EXISTS ps_time_roundtrip');
    await exec.execute(
      `CREATE TABLE ps_time_roundtrip (d date, ts timestamp, tstz timestamptz)`,
    );
    await exec.execute(
      `INSERT INTO ps_time_roundtrip VALUES (DATE '2024-01-15', TIMESTAMP '2024-01-15 12:30:00', TIMESTAMPTZ '2024-01-15 12:30:00+08:00')`,
    );
    const res = await exec.execute('SELECT d, ts, tstz FROM ps_time_roundtrip');
    expect(res.rows[0]?.[0]).toBe('2024-01-15');
    expect(res.rows[0]?.[1]).toBe('2024-01-15 12:30:00');
    expect(res.rows[0]?.[2]).toBe(new Date('2024-01-15T12:30:00+08:00').toISOString());
    await exec.execute('DROP TABLE ps_time_roundtrip');
  });
});

describe('maxRows 限行（回归缺陷：字符串/注释绕过与 truncated 误报）', () => {
  beforeAll(async () => {
    if (!shared) throw new Error('共享连接未建立');
    const exec = shared.getQueryExecutor();
    await exec.execute('DROP TABLE IF EXISTS ps_limit');
    await exec.execute('CREATE TABLE ps_limit (id int, msg text)');
    // 12 行 msg='no limit'，正好能暴露"字符串命中正则导致不加 LIMIT"
    await exec.execute(
      `INSERT INTO ps_limit SELECT g, CASE WHEN g % 2 = 0 THEN 'no limit' ELSE 'other' END
         FROM generate_series(1, 25) g`,
    );
  });

  it("SQL 字面量含 'no limit' 时仍会被限行", async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared
      .getQueryExecutor()
      .execute("SELECT id, msg FROM ps_limit WHERE msg = 'no limit'", { maxRows: 3 });
    expect(res.rows).toHaveLength(3);
    expect(res.truncated).toBe(true);
  });

  it('行尾 -- 注释不会吞掉追加的 LIMIT', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared.getQueryExecutor().execute('SELECT id FROM ps_limit -- no limit', {
      maxRows: 4,
    });
    expect(res.rows).toHaveLength(4);
    expect(res.truncated).toBe(true);
  });

  it('结果恰好等于 maxRows 时 truncated 为 false', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared.getQueryExecutor().execute('SELECT id FROM ps_limit', { maxRows: 25 });
    expect(res.rows).toHaveLength(25);
    expect(res.truncated).toBe(false);
  });

  it('超过 maxRows 时截断到 maxRows', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared.getQueryExecutor().execute('SELECT id FROM ps_limit', { maxRows: 5 });
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });
});

describe('只读连接（回归缺陷：只读保护未在驱动层生效）', () => {
  it('executeUpdate 绕过应用层判定，仍被数据库层拒绝', async () => {
    if (!shared || !readOnlyConn) throw new Error('连接未建立');
    const exec = shared.getQueryExecutor();
    const before = await exec.execute('SELECT count(*) AS c FROM ps_limit');
    const countBefore = Number(before.rows[0]?.[0]);

    // executeUpdate 完全不做 isWriteStatement 判定，唯一能拦住它的是只读事务
    const err = await readOnlyConn
      .getQueryExecutor()
      .executeUpdate("INSERT INTO ps_limit (id, msg) VALUES (999, 'should not land')")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // 应用层只读保护是 READONLY_VIOLATION(403)；这里必须来自数据库层
    expect((err as { code?: string }).code).not.toBe('READONLY_VIOLATION');

    const after = await exec.execute('SELECT count(*) AS c FROM ps_limit');
    expect(Number(after.rows[0]?.[0])).toBe(countBefore);
  });

  it('executeUpdate 的 DDL 同样被数据库层拒绝', async () => {
    if (!readOnlyConn) throw new Error('只读连接未建立');
    await expect(readOnlyConn.getQueryExecutor().executeUpdate('CREATE TABLE ps_ro_x (a int)')).rejects.toThrow();
  });

  it('应用层也会直接拦下写语句', async () => {
    if (!readOnlyConn) throw new Error('只读连接未建立');
    await expect(
      readOnlyConn.getQueryExecutor().execute("INSERT INTO ps_limit (id) VALUES (1000)"),
    ).rejects.toMatchObject({ code: 'READONLY_VIOLATION' });
  });

  it('只读连接仍可正常查询', async () => {
    if (!readOnlyConn) throw new Error('只读连接未建立');
    const res = await readOnlyConn.getQueryExecutor().execute('SELECT count(*) AS c FROM ps_limit');
    expect(Number(res.rows[0]?.[0])).toBe(25);
  });
});

describe('表达式索引（回归缺陷：lower(email) 被当成列名导致非法 DDL）', () => {
  it('表达式索引被识别并跳过，剩余索引生成的 DDL 可真正执行', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const exec = shared.getQueryExecutor();
    const meta = shared.getMetadata();
    const ddl = shared.getDdlGenerator();

    await exec.execute('DROP TABLE IF EXISTS ps_expr');
    await exec.execute('DROP TABLE IF EXISTS ps_expr_copy');
    // 刻意不用 serial：默认值会引用序列名，删表后重建会因序列不存在而失败，干扰本用例
    await exec.execute('CREATE TABLE ps_expr (id integer PRIMARY KEY, email text)');
    await exec.execute('CREATE INDEX ps_expr_email ON ps_expr (email)');
    await exec.execute('CREATE INDEX ps_expr_lower ON ps_expr (lower(email))');

    const indexes = await meta.listIndexes('public', 'ps_expr');
    const names = indexes.map((i) => i.name);
    expect(names).toContain('ps_expr_email');
    // 表达式索引无法用 IndexInfo 表达，必须被跳过而不是返回 "lower(email)" 伪列名
    expect(names).not.toContain('ps_expr_lower');
    expect(indexes.find((i) => i.name === 'ps_expr_email')?.columns).toEqual(['email']);

    const columns = await meta.listColumns('public', 'ps_expr');
    // 释放索引名后，用真实列生成的建表 DDL 必须能执行（旧实现会因 "lower(email)" 抛错）
    await exec.execute('DROP TABLE ps_expr');
    const generated = ddl.createTable(
      'public',
      'ps_expr_copy',
      columns,
      indexes.filter((i) => !i.primary),
    );
    await exec.execute(generated);

    const back = await meta.listIndexes('public', 'ps_expr_copy');
    expect(back.map((i) => i.name)).toContain('ps_expr_email');
    await exec.execute('DROP TABLE ps_expr_copy');
  });

  it('SELECT 1 AS x, 2 AS x 保留两列（验证结果按列顺序返回）', async () => {
    if (!shared) throw new Error('共享连接未建立');
    const res = await shared.getQueryExecutor().execute('SELECT 1 AS x, 2 AS x');
    expect(res.columns.map((c) => c.name)).toEqual(['x', 'x']);
    expect(res.rows[0]).toEqual([1, 2]);
  });
});
