/**
 * 花生苗数据库管理工具 - 异构迁移端到端测试（SQLite → 真实 PostgreSQL）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这是 AC-02 的核心验证：把数据从 SQLite **真的**迁到另一个数据库引擎里。
 * 两端都是真实实现 —— 源端是 node:sqlite，目标端是真实 PostgreSQL
 * （PGlite 是 PostgreSQL 编译到 WASM 的发行版，走标准 PG 线协议）。
 *
 * 重点覆盖那些"只有真跑一遍才会暴露"的环节：
 *   - 跨方言类型映射（SQLite INTEGER/TEXT → PG integer/text）
 *   - 分批写入是否真的把**所有**行都搬过去了（曾经有过只迁一页就报成功的缺陷）
 *   - 表结构、主键、索引是否在目标端被重建
 *   - 特殊值与 NULL 的保真
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig, DatabaseDriver, DriverConnection, ConnectionTestResult, DbTypeInfo } from '@peanutsprout/core';
import { createDefaultRegistry, PostgresDriver } from '@peanutsprout/drivers';
import { MigrationEngine } from './engine.js';

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

/** 行数刻意大于两倍批大小，用来证明分批循环真的走完了（回归防护） */
const USER_ROWS = 300;
const ORDER_ROWS = 350;

let dir = '';
let sqlitePath = '';
let pgPort = 0;
let pgDb: { close(): Promise<void> } | null = null;
let pgServer: { stop(): Promise<void> } | null = null;
const configs = new Map<number, ConnectionConfig>();

/**
 * PGLiteSocketServer 一生只服务一个客户端连接，断开后不再接受新连接，
 * 而 MigrationEngine 每次调用都会自己开/关连接。因此这里在**驱动边界**
 * 固定一条目标端连接：引擎、SQLite 驱动、PostgreSQL 驱动与真实 PG 服务端
 * 全部照常参与，仅连接生命周期被钉住。close() 变成空操作，真正的关闭放到
 * afterAll，这样跨多次引擎调用共享同一条 PG 连接。
 */
let targetConn: DriverConnection | null = null;

function makeStableTargetDriver(): DatabaseDriver {
  const real = new PostgresDriver();
  return {
    dbType: real.dbType,
    name: real.name,
    version: real.version,
    implemented: real.implemented,
    capabilities: real.capabilities,
    getInfo: (): DbTypeInfo => real.getInfo(),
    testConnection: (config: ConnectionConfig): Promise<ConnectionTestResult> => real.testConnection(config),
    connect: async (config: ConnectionConfig): Promise<DriverConnection> => {
      if (!targetConn) targetConn = await real.connect(config);
      const conn = targetConn;
      return {
        id: conn.id,
        config: conn.config,
        ping: () => conn.ping(),
        getMetadata: () => conn.getMetadata(),
        getQueryExecutor: () => conn.getQueryExecutor(),
        getDdlGenerator: () => conn.getDdlGenerator(),
        getTypeMapper: () => conn.getTypeMapper(),
        getExplainParser: () => conn.getExplainParser(),
        // 空操作：连接由本文件统一持有，见上面的说明
        close: async () => undefined,
      };
    },
  };
}

let stableTarget: DatabaseDriver | null = null;

function sourceConfig(): ConnectionConfig {
  return {
    id: 101,
    name: 'sqlite-source',
    dbType: 'sqlite',
    databaseName: sqlitePath,
    readOnly: false,
  };
}

function targetConfig(): ConnectionConfig {
  return {
    id: 102,
    name: 'pg-target',
    dbType: 'postgresql',
    host: '127.0.0.1',
    port: pgPort,
    databaseName: 'postgres',
    username: 'postgres',
    password: '',
    readOnly: false,
  };
}

function makeSource(): void {
  const db = new DatabaseSync(sqlitePath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT,
      score REAL,
      created_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      status TEXT,
      memo TEXT
    );
    CREATE INDEX idx_orders_user ON orders (user_id);
  `);
  const insertUser = db.prepare('INSERT INTO users (id, name, region, score, created_at) VALUES (?,?,?,?,?)');
  const insertOrder = db.prepare('INSERT INTO orders (id, user_id, amount, status, memo) VALUES (?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 1; i <= USER_ROWS; i++) {
    // 每 37 行留一个 NULL region，验证可空列保真
    insertUser.run(i, `用户${i}`, i % 37 === 0 ? null : `区域${i % 7}`, i * 1.5, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  for (let i = 1; i <= ORDER_ROWS; i++) {
    insertOrder.run(i, (i % USER_ROWS) + 1, i * 0.25, i % 3 === 0 ? 'paid' : 'pending', i % 41 === 0 ? null : `备注'${i}"引号`);
  }
  db.exec('COMMIT');
  db.close();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-migrate-'));
  sqlitePath = join(dir, 'source.db');
  makeSource();

  pgPort = await freePort();
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const instance = await PGlite.create();
  const srv = new PGLiteSocketServer({ db: instance, port: pgPort, host: '127.0.0.1' });
  await srv.start();
  pgDb = instance as unknown as { close(): Promise<void> };
  pgServer = srv as unknown as { stop(): Promise<void> };

  configs.set(101, sourceConfig());
  configs.set(102, targetConfig());
  stableTarget = makeStableTargetDriver();
  // 预热：把唯一那条 PG 连接建起来
  targetConn = await new PostgresDriver().connect(targetConfig());
}, 180_000);

afterAll(async () => {
  await targetConn?.close().catch(() => undefined);
  await pgServer?.stop().catch(() => undefined);
  // 让 PGlite 的延迟清理回调（setImmediate）先跑完再关库，
  // 否则会抛 _IsTransactionBlock 的未处理拒绝（第三方库时序缺陷）
  await new Promise((resolve) => setTimeout(resolve, 300));
  await pgDb?.close().catch(() => undefined);
  if (dir) rmSync(dir, { recursive: true, force: true });
}, 60_000);

function makeEngine(): MigrationEngine {
  const registry = createDefaultRegistry();
  return new MigrationEngine({
    resolveDriver: (dbType) => {
      if (dbType === 'postgresql' && stableTarget) return stableTarget;
      return registry.require(dbType);
    },
    resolveConfig: (id) => configs.get(id) ?? null,
  });
}

/** 直接复用那条稳定的目标连接做断言查询 */
async function queryTarget(sql: string): Promise<unknown[][]> {
  if (!targetConn) throw new Error('目标连接未建立');
  const res = await targetConn.getQueryExecutor().execute(sql);
  return res.rows;
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    userId: 1,
    sourceConnectionId: 101,
    targetConnectionId: 102,
    sourceSchema: 'main',
    targetSchema: 'public',
    tables: ['users', 'orders'],
    // 迁移模式必须使用合法取值（'full' | 'incremental' | 'sync'）。
    // 这里要验证的是"结构 + 数据"全量迁移，由 includeStructure/includeData 控制。
    mode: 'full' as const,
    includeStructure: true,
    includeData: true,
    batchSize: 100,
    ...overrides,
  };
}

describe('异构迁移：SQLite → 真实 PostgreSQL', () => {
  it('预检报告能识别跨方言类型映射', async () => {
    const engine = makeEngine();
    const report = await engine.precheck(baseRequest() as never);
    expect(report.ok).toBe(true);
    expect(report.estimatedRows).toBeGreaterThanOrEqual(USER_ROWS + ORDER_ROWS);
    expect(report.tableMappings.length).toBeGreaterThanOrEqual(2);
    const users = report.tableMappings.find((t) => t.sourceTable === 'users');
    expect(users).toBeDefined();
    // SQLite 的 5 个列都应出现在映射里
    expect(users?.columnMappings.length).toBe(5);
    const region = users?.columnMappings.find((c) => c.sourceColumn === 'region');
    expect(region?.targetType).toBeTruthy();
    // 类型映射结果必须是 PG 方言的类型名
    const idCol = users?.columnMappings.find((c) => c.sourceColumn === 'id');
    expect(String(idCol?.targetType).toLowerCase()).toMatch(/int|serial|numeric/);
  }, 120_000);

  it('dryRun 只出报告不落库', async () => {
    const engine = makeEngine();
    const result = await engine.migrate(baseRequest({ dryRun: true }) as never);
    // dryRun 不应写入任何行
    expect(result.successRows).toBe(0);
    expect(result.status).toBe('success');
    // 目标端不应出现 users 表
    const tables = await targetConn!.getMetadata().listTables('public');
    expect(tables.map((t) => t.name)).not.toContain('users');
  }, 120_000);

  it('真正迁移：全部 ' + USER_ROWS + ' 用户与 ' + ORDER_ROWS + ' 订单都到达目标库', async () => {
    const engine = makeEngine();
    const progress: Array<{ table?: string; processedRows: number }> = [];
    const result = await engine.migrate(baseRequest() as never, (p) => {
      progress.push({ ...(p.table ? { table: p.table } : {}), processedRows: p.processedRows });
    });

    // 结构 + 数据都要成功（无失败行）
    expect(result.status).toBe('success');
    expect(result.failedRows).toBe(0);
    expect(result.successRows).toBe(USER_ROWS + ORDER_ROWS);

    const userCount = Number((await queryTarget('SELECT count(*) AS c FROM users'))[0]?.[0]);
    const orderCount = Number((await queryTarget('SELECT count(*) AS c FROM orders'))[0]?.[0]);
    // 关键回归防护：分批必须循环到底，不能只迁第一页
    expect(userCount).toBe(USER_ROWS);
    expect(orderCount).toBe(ORDER_ROWS);

    // 进度回调必须真的上报过（界面进度条依赖它）
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.max(...progress.map((p) => p.processedRows))).toBeGreaterThan(0);
  }, 180_000);

  it('跨方言数据保真：中文 / NULL / 含引号的字符串', async () => {
    const rows = await queryTarget("SELECT name, region FROM users WHERE id = 1");
    expect(rows[0]?.[0]).toBe('用户1');
    expect(rows[0]?.[1]).toBe('区域1');

    // 可空列在目标端必须仍是 NULL，而不是空串
    const nullRows = await queryTarget('SELECT count(*) AS c FROM users WHERE region IS NULL');
    expect(Number(nullRows[0]?.[0])).toBe(Math.floor(USER_ROWS / 37));

    // 带单引号与双引号的字符串要原样保留（参数绑定路径）
    // 注意 41 号订单的 memo 本来就是 NULL，这里取 42 号验证引号保真
    const quoted = await queryTarget('SELECT memo FROM orders WHERE id = 42');
    expect(quoted[0]?.[0]).toBe('备注\'42"引号');
    const nullMemo = await queryTarget('SELECT memo FROM orders WHERE id = 41');
    expect(nullMemo[0]?.[0]).toBeNull();

    const numeric = await queryTarget('SELECT score FROM users WHERE id = 3');
    expect(Number(numeric[0]?.[0])).toBeCloseTo(4.5, 5);
  }, 120_000);

  it('表结构与主键在目标端被重建，索引也被迁移', async () => {
    const conn = targetConn;
    if (!conn) throw new Error('目标连接未建立');
    {
      const meta = conn.getMetadata();
      const tables = await meta.listTables('public');
      expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['users', 'orders']));

      const columns = await meta.listColumns('public', 'users');
      expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'region', 'score', 'created_at']);
      expect(columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);
      // NOT NULL 约束要跟着过来
      expect(columns.find((c) => c.name === 'name')?.nullable).toBe(false);
      expect(columns.find((c) => c.name === 'region')?.nullable).toBe(true);

      const indexes = await meta.listIndexes('public', 'orders');
      expect(indexes.map((i) => i.name)).toContain('idx_orders_user');
    }
  }, 120_000);

  it('目标端已有数据时按冲突策略处理，且不丢行', async () => {
    const engine = makeEngine();
    // 再迁一次（目标端已有全量数据），默认跳过冲突
    const again = await engine.migrate(baseRequest({ batchSize: 200 }) as never);
    expect(again.status).toBe('success');
    expect(again.failedRows).toBe(0);
    const userCount = Number((await queryTarget('SELECT count(*) AS c FROM users'))[0]?.[0]);
    // 跳过冲突不应产生重复行
    expect(userCount).toBe(USER_ROWS);
  }, 180_000);

  it('overwrite 策略在真实 PostgreSQL 上按主键覆盖，不产生重复行', async () => {
    const engine = makeEngine();
    // 改写源端第 1 行，验证 UPDATE 真的把新值写进 PG（同时覆盖复合参数顺序）
    const db = new DatabaseSync(sqlitePath);
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run('已改名-1', 1);
    db.close();

    const result = await engine.migrate(
      baseRequest({ includeStructure: false, conflictStrategy: 'overwrite', batchSize: 200 }) as never,
    );
    expect(result.status).toBe('success');
    expect(result.failedRows).toBe(0);

    const userCount = Number((await queryTarget('SELECT count(*) AS c FROM users'))[0]?.[0]);
    expect(userCount).toBe(USER_ROWS);
    const name = (await queryTarget('SELECT name FROM users WHERE id = 1'))[0]?.[0];
    expect(name).toBe('已改名-1');
  }, 180_000);
});
