/**
 * 花生苗数据库管理工具 - 迁移引擎测试（真实 SQLite → SQLite）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 引擎只依赖驱动 SPI，因此这套测试同时验证了 SPI 设计是否站得住：
 * 建结构、搬数据、类型映射、冲突策略、预检报告全部走真实数据库。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ConnectionConfig,
  DatabaseDriver,
  DriverConnection,
  MigrationRequest,
  QueryExecutor,
  QueryOptions,
} from '@peanutsprout/core';
import { createDefaultRegistry, type ConnectionManager } from '@peanutsprout/drivers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationEngine } from './engine.js';

let dir: string;
let sourcePath: string;
let targetPath: string;
let configs: Map<number, ConnectionConfig>;
let engine: MigrationEngine;
let manager: ConnectionManager;

const SOURCE_ID = 1;
const TARGET_ID = 2;

function configFor(id: number, path: string): ConnectionConfig {
  return { id, name: `db-${id}`, dbType: 'sqlite', databaseName: path, readOnly: false } as ConnectionConfig;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-migrate-'));
  sourcePath = join(dir, 'source.db');
  targetPath = join(dir, 'target.db');

  configs = new Map([
    [SOURCE_ID, configFor(SOURCE_ID, sourcePath)],
    [TARGET_ID, configFor(TARGET_ID, targetPath)],
  ]);

  const registry = createDefaultRegistry();
  manager = new (await import('@peanutsprout/drivers')).ConnectionManager(registry);

  engine = new MigrationEngine({
    resolveDriver: (dbType) => registry.require(dbType),
    resolveConfig: (id) => configs.get(id) ?? null,
  });

  // 准备源库：两张表 + 中文/空值/小数/二进制
  const conn = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
  const exec = conn.getQueryExecutor();
  await exec.execute(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    score REAL,
    avatar BLOB
  );`);
  await exec.execute('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);');
  await exec.execute(
    "INSERT INTO users (id, name, email, score) VALUES (1, '张三', 'a@b.com', 90.5), (2, '李四', NULL, 77.25), (3, '王五', NULL, NULL)",
  );
  await exec.execute('INSERT INTO orders (id, user_id, amount) VALUES (1, 1, 10.5), (2, 2, 20.25)');
  await conn.close();
});

afterEach(async () => {
  await manager.releaseAll().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

function request(overrides: Partial<MigrationRequest> = {}): MigrationRequest {
  return {
    userId: 1,
    sourceConnectionId: SOURCE_ID,
    targetConnectionId: TARGET_ID,
    sourceSchema: 'main',
    targetSchema: 'main',
    tables: [],
    mode: 'full',
    includeStructure: true,
    includeData: true,
    ...overrides,
  };
}

/** 直接读目标库，验证迁移结果（不复用引擎代码，避免自证） */
async function readTarget<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  return readFrom<T>(TARGET_ID, sql);
}

/** 直接读指定连接，验证迁移结果 */
async function readFrom<T extends Record<string, unknown>>(id: number, sql: string): Promise<T[]> {
  const registry = createDefaultRegistry();
  const conn = await registry.require('sqlite').connect(configs.get(id) as ConnectionConfig);
  try {
    const result = await conn.getQueryExecutor().execute(sql);
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj as T;
    });
  } finally {
    await conn.close();
  }
}

/** 用给定执行器包装一个真实连接（保留其余方法） */
function wrapConnection(conn: DriverConnection, exec: QueryExecutor): DriverConnection {
  return {
    id: conn.id,
    config: conn.config,
    ping: () => conn.ping(),
    getMetadata: () => conn.getMetadata(),
    getQueryExecutor: () => exec,
    getDdlGenerator: () => conn.getDdlGenerator(),
    getTypeMapper: () => conn.getTypeMapper(),
    getExplainParser: () => conn.getExplainParser(),
    close: () => conn.close(),
  };
}

/**
 * 造一个"源端包装驱动"：记录所有发给源库的 SQL，
 * 用于断言分页查询确实带了稳定 ORDER BY（回归防护：无排序分页会静默漏行）。
 */
function makeRecordingSourceDriver(recorded: string[]): DatabaseDriver {
  const real = createDefaultRegistry().require('sqlite');
  return {
    dbType: real.dbType,
    name: real.name,
    version: real.version,
    implemented: real.implemented,
    capabilities: real.capabilities,
    getInfo: () => real.getInfo(),
    testConnection: (config: ConnectionConfig) => real.testConnection(config),
    connect: async (config: ConnectionConfig) => {
      const conn = await real.connect(config);
      if (config.id !== SOURCE_ID) return conn;
      const base = conn.getQueryExecutor();
      const recordedExec: QueryExecutor = {
        execute: (sql: string, options?: QueryOptions) => {
          recorded.push(sql);
          return base.execute(sql, options);
        },
        executeUpdate: (sql: string, params) => base.executeUpdate(sql, params),
        explain: (sql: string) => base.explain(sql),
        cancel: (queryId: string) => base.cancel(queryId),
      };
      return wrapConnection(conn, recordedExec);
    },
  };
}

/**
 * 造一个"会在第二页分页查询时抛错"的源端驱动，模拟第一次迁移中途失败。
 * 只在第一次运行（flag.on）时生效，便于第二次正常重跑。
 */
function makeFlakySourceDriver(flag: { on: boolean }): DatabaseDriver {
  const real = createDefaultRegistry().require('sqlite');
  return {
    dbType: real.dbType,
    name: real.name,
    version: real.version,
    implemented: real.implemented,
    capabilities: real.capabilities,
    getInfo: () => real.getInfo(),
    testConnection: (config: ConnectionConfig) => real.testConnection(config),
    connect: async (config: ConnectionConfig) => {
      const conn = await real.connect(config);
      if (config.id !== SOURCE_ID) return conn;
      const base = conn.getQueryExecutor();
      let pages = 0;
      const flakyExec: QueryExecutor = {
        execute: (sql: string, options?: QueryOptions) => {
          if (flag.on && /LIMIT \d+ OFFSET \d+/.test(sql)) {
            pages += 1;
            if (pages >= 2) throw new Error('模拟源端中途失败');
          }
          return base.execute(sql, options);
        },
        executeUpdate: (sql: string, params) => base.executeUpdate(sql, params),
        explain: (sql: string) => base.explain(sql),
        cancel: (queryId: string) => base.cancel(queryId),
      };
      return wrapConnection(conn, flakyExec);
    },
  };
}

/** 造一个"不支持 ORDER BY"的源端驱动，验证无主键时的安全降级路径。 */
function makeNoOrderSourceDriver(): DatabaseDriver {
  const real = createDefaultRegistry().require('sqlite');
  return {
    dbType: real.dbType,
    name: real.name,
    version: real.version,
    implemented: real.implemented,
    capabilities: real.capabilities,
    getInfo: () => real.getInfo(),
    testConnection: (config: ConnectionConfig) => real.testConnection(config),
    connect: async (config: ConnectionConfig) => {
      const conn = await real.connect(config);
      if (config.id !== SOURCE_ID) return conn;
      const base = conn.getQueryExecutor();
      const exec: QueryExecutor = {
        execute: (sql: string, options?: QueryOptions) => {
          if (/ORDER BY/i.test(sql)) throw new Error('该库不支持按全部列排序');
          return base.execute(sql, options);
        },
        executeUpdate: (sql: string, params) => base.executeUpdate(sql, params),
        explain: (sql: string) => base.explain(sql),
        cancel: (queryId: string) => base.cancel(queryId),
      };
      return wrapConnection(conn, exec);
    },
  };
}

describe('预检', () => {
  it('预检报告包含表映射与行数估算', async () => {
    const result = await engine.precheck(request());
    expect(result.ok).toBe(true);
    expect(result.tableMappings.map((m) => m.sourceTable).sort()).toEqual(['orders', 'users']);
    expect(result.estimatedRows).toBe(5);

    const users = result.tableMappings.find((m) => m.sourceTable === 'users');
    expect(users?.columnMappings.map((c) => c.sourceColumn)).toEqual([
      'id',
      'name',
      'email',
      'score',
      'avatar',
    ]);
    // 同构迁移不应出现有损映射
    expect(users?.columnMappings.every((c) => !c.lossy)).toBe(true);
  });

  it('预检不写入任何数据', async () => {
    await engine.precheck(request());
    const rows = await readTarget<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='users'",
    );
    // readTarget 已把行转成以列名为键的对象
    expect(Number(rows[0]?.['c'] ?? -1)).toBe(0);
  });

  it('指定不存在的表会报 error', async () => {
    const result = await engine.precheck(request({ tables: ['not_there'] }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('目标端已有同名表时给出 warning（默认不覆盖）', async () => {
    const registry = createDefaultRegistry();
    const target = await registry.require('sqlite').connect(configs.get(TARGET_ID) as ConnectionConfig);
    await target.getQueryExecutor().execute('CREATE TABLE users (id INTEGER PRIMARY KEY);');
    await target.close();

    const result = await engine.precheck(request());
    expect(result.issues.some((i) => i.level === 'warning' && i.table === 'users')).toBe(true);
  });

  it('连接不存在时抛 NOT_FOUND', async () => {
    await expect(engine.precheck(request({ sourceConnectionId: 999 }))).rejects.toThrow(/源连接/);
    await expect(engine.precheck(request({ targetConnectionId: 999 }))).rejects.toThrow(/目标连接/);
  });
});

describe('执行迁移', () => {
  it('迁移结构 + 数据，行数与内容正确', async () => {
    const result = await engine.migrate(request());

    expect(result.status).toBe('success');
    expect(result.successRows).toBe(5);
    expect(result.failedRows).toBe(0);

    const users = await readTarget<{ id: number; name: string; email: string | null; score: number | null }>(
      'SELECT id, name, email, score FROM users ORDER BY id',
    );
    expect(users).toHaveLength(3);
    expect(users[0]?.['name']).toBe('张三');
    expect(users[0]?.['score']).toBe(90.5);
    // NULL 必须原样搬过去，不能被转成字符串
    expect(users[1]?.['email']).toBeNull();
    expect(users[2]?.['score']).toBeNull();

    const orders = await readTarget('SELECT * FROM orders');
    expect(orders).toHaveLength(2);
  });

  it('目标表结构与源表一致（列名与非空约束）', async () => {
    await engine.migrate(request());
    const columns = await readTarget<{ name: string; notnull: number; pk: number }>(
      'PRAGMA table_info(users)',
    );
    expect(columns.map((c) => c['name'])).toEqual(['id', 'name', 'email', 'score', 'avatar']);
    expect(Number(columns.find((c) => c['name'] === 'name')?.['notnull'])).toBe(1);
    expect(Number(columns.find((c) => c['name'] === 'id')?.['pk'])).toBe(1);
  });

  it('只迁移结构时不动数据', async () => {
    const result = await engine.migrate(request({ includeData: false }));
    expect(result.status).toBe('success');
    expect(result.successRows).toBe(0);
    const rows = await readTarget<Record<string, unknown>>('SELECT * FROM users');
    expect(rows).toHaveLength(0);
  });

  it('只迁移数据（目标表已存在）', async () => {
    const registry = createDefaultRegistry();
    const target = await registry.require('sqlite').connect(configs.get(TARGET_ID) as ConnectionConfig);
    await target.getQueryExecutor().execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, score REAL, avatar BLOB);',
    );
    await target.close();

    const result = await engine.migrate(request({ tables: ['users'], includeStructure: false }));
    expect(result.successRows).toBe(3);
    const rows = await readTarget('SELECT * FROM users');
    expect(rows).toHaveLength(3);
  });

  it('可以只迁移指定表', async () => {
    await engine.migrate(request({ tables: ['orders'] }));
    const users = await readTarget<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(users).toHaveLength(0);
    expect(await readTarget('SELECT * FROM orders')).toHaveLength(2);
  });

  it('dryRun 只预检不写入（连表都不会创建）', async () => {
    const result = await engine.migrate(request({ dryRun: true }));
    expect(result.successRows).toBe(0);
    const tables = await readTarget<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','orders')",
    );
    expect(tables).toHaveLength(0);
  });

  it('冲突策略 skip：按行跳过已存在主键，补入缺失行（不再整表跳过）', async () => {
    const registry = createDefaultRegistry();
    const target = await registry.require('sqlite').connect(configs.get(TARGET_ID) as ConnectionConfig);
    await target.getQueryExecutor().execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, score REAL, avatar BLOB);',
    );
    // id=1 与源冲突（应跳过并保留原值），id=99 是目标独有（必须保留）
    await target
      .getQueryExecutor()
      .execute("INSERT INTO users (id, name) VALUES (1, '已有1'), (99, '已有数据')");
    await target.close();

    const result = await engine.migrate(
      request({ tables: ['users'], includeStructure: false, conflictStrategy: 'skip' }),
    );
    expect(result.status).toBe('success');
    expect(result.successRows).toBe(2);
    expect(result.failedRows).toBe(0);
    expect(result.skippedRows).toBe(1);

    const rows = await readTarget<{ id: number; name: string }>('SELECT id, name FROM users ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 99]);
    // skip 不覆盖目标既有行
    expect(rows.find((r) => r.id === 1)?.['name']).toBe('已有1');
  });

  it('冲突策略 overwrite：覆盖同主键行且不产生重复', async () => {
    const registry = createDefaultRegistry();
    const target = await registry.require('sqlite').connect(configs.get(TARGET_ID) as ConnectionConfig);
    await target.getQueryExecutor().execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, score REAL, avatar BLOB);',
    );
    await target.getQueryExecutor().execute("INSERT INTO users (id, name) VALUES (1, '旧值')");
    await target.close();

    const result = await engine.migrate(
      request({ tables: ['users'], includeStructure: false, conflictStrategy: 'overwrite' }),
    );
    expect(result.status).toBe('success');
    expect(result.successRows).toBe(3);
    const rows = await readTarget<{ id: number; name: string }>('SELECT id, name FROM users ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows.find((r) => r.id === 1)?.['name']).toBe('张三');
  });

  it('冲突策略 error：主键冲突记为失败行且不覆盖目标数据', async () => {
    const registry = createDefaultRegistry();
    const target = await registry.require('sqlite').connect(configs.get(TARGET_ID) as ConnectionConfig);
    await target.getQueryExecutor().execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, score REAL, avatar BLOB);',
    );
    await target.getQueryExecutor().execute("INSERT INTO users (id, name) VALUES (1, '已有1')");
    await target.close();

    const result = await engine.migrate(
      request({ tables: ['users'], includeStructure: false, conflictStrategy: 'error' }),
    );
    expect(result.status).toBe('failed');
    expect(result.failedRows).toBe(1);
    expect(result.successRows).toBe(2);
    const rows = await readTarget<{ id: number; name: string }>('SELECT id, name FROM users ORDER BY id');
    expect(rows.find((r) => r.id === 1)?.['name']).toBe('已有1');
  });

  it('大批量数据分页迁移不丢行', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, payload TEXT);');
    for (let i = 0; i < 250; i++) {
      await exec.execute('INSERT INTO big (id, payload) VALUES (?, ?)', { params: [i, `p${i}`] });
    }
    await source.close();

    await engine.migrate(request({ tables: ['big'], batchSize: 50 }));
    const rows = await readTarget<{ c: number }>('SELECT COUNT(*) AS c FROM big');
    expect(Number(rows[0]?.['c'])).toBe(250);
  });

  it('进度回调会按表上报', async () => {
    const seen: string[] = [];
    await engine.migrate(request({ tables: ['users'] }), (p) => {
      seen.push(p.phase);
    });
    expect(seen).toContain('structure');
    expect(seen).toContain('data');
  });

  it('迁移报告包含起止时间与状态', async () => {
    const result = await engine.migrate(request());
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.migrationId).toBeTruthy();
  });

  it('预检有 error 时拒绝执行（除非 dryRun）', async () => {
    await expect(engine.migrate(request({ tables: ['not_there'] }))).rejects.toThrow();
  });
});

describe('分页稳定性（缺陷回归）', () => {
  it('有空洞的多行表分批迁移后，目标行集合与源完全一致', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE staged (id INTEGER PRIMARY KEY, payload TEXT);');
    for (let i = 0; i < 60; i++) {
      await exec.execute('INSERT INTO staged (id, payload) VALUES (?, ?)', { params: [i, `p${i}`] });
    }
    // 制造空洞后按逆序重插，让物理顺序与 id 顺序不一致
    await exec.execute('DELETE FROM staged WHERE id BETWEEN 10 AND 30');
    for (let i = 30; i >= 10; i--) {
      await exec.execute('INSERT INTO staged (id, payload) VALUES (?, ?)', { params: [i, `r${i}`] });
    }
    await source.close();

    await engine.migrate(request({ tables: ['staged'], batchSize: 7 }));

    const src = await readFrom<{ id: number; payload: string }>(
      SOURCE_ID,
      'SELECT id, payload FROM staged ORDER BY id',
    );
    const dst = await readTarget<{ id: number; payload: string }>(
      'SELECT id, payload FROM staged ORDER BY id',
    );
    expect(dst).toHaveLength(60);
    expect(dst).toEqual(src);
  });

  it('每一页分页查询都带稳定 ORDER BY（主键优先）', async () => {
    const recorded: string[] = [];
    const recordingEngine = new MigrationEngine({
      resolveDriver: () => makeRecordingSourceDriver(recorded),
      resolveConfig: (id) => configs.get(id) ?? null,
    });

    await recordingEngine.migrate(request({ tables: ['users'], batchSize: 2 }));

    const pages = recorded.filter((sql) => /LIMIT \d+ OFFSET \d+/.test(sql));
    expect(pages.length).toBeGreaterThan(0);
    for (const sql of pages) {
      expect(sql).toMatch(/ORDER BY/i);
      // users 有主键 id，排序必须用它
      expect(sql).toMatch(/"id"/);
    }
  });

  it('无主键表回退为按全部列排序，分页不丢行并在报告标注', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE logs (message TEXT, level TEXT);');
    for (let i = 0; i < 25; i++) {
      await exec.execute('INSERT INTO logs (message, level) VALUES (?, ?)', {
        params: [`m${i}`, i % 2 === 1 ? 'warn' : 'info'],
      });
    }
    await source.close();

    const result = await engine.migrate(request({ tables: ['logs'], batchSize: 4 }));
    expect(result.status).toBe('success');
    const report = result.tables.find((t) => t.table === 'logs');
    expect(report?.pagination).toBe('all-columns');
    expect(report?.orderBy).toEqual(['message', 'level']);

    const src = await readFrom<{ message: string; level: string }>(
      SOURCE_ID,
      'SELECT message, level FROM logs ORDER BY message',
    );
    const dst = await readTarget<{ message: string; level: string }>(
      'SELECT message, level FROM logs ORDER BY message',
    );
    expect(dst).toHaveLength(25);
    expect(dst).toEqual(src);
  });

  it('无主键且全列排序不被支持时，降级为单次全量读取并在报告标注', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE logs (message TEXT, level TEXT);');
    for (let i = 0; i < 25; i++) {
      await exec.execute('INSERT INTO logs (message, level) VALUES (?, ?)', {
        params: [`m${i}`, i % 2 === 1 ? 'warn' : 'info'],
      });
    }
    await source.close();

    const fallbackEngine = new MigrationEngine({
      resolveDriver: () => makeNoOrderSourceDriver(),
      resolveConfig: (id) => configs.get(id) ?? null,
    });
    const result = await fallbackEngine.migrate(request({ tables: ['logs'], batchSize: 4 }));

    expect(result.status).toBe('success');
    const report = result.tables.find((t) => t.table === 'logs');
    expect(report?.pagination).toBe('single-pass');
    expect(report?.message).toMatch(/单次全量读取/);

    const dst = await readTarget<{ message: string }>('SELECT message FROM logs ORDER BY message');
    expect(dst).toHaveLength(25);
  });
});

describe('失败重跑（缺陷回归）', () => {
  it('第一次中途失败后重跑，按行补齐缺失数据，最终目标行数与源一致', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, payload TEXT);');
    for (let i = 1; i <= 120; i++) {
      await exec.execute('INSERT INTO items (id, payload) VALUES (?, ?)', { params: [i, `i${i}`] });
    }
    await source.close();

    const flag = { on: true };
    const flakyEngine = new MigrationEngine({
      resolveDriver: () => makeFlakySourceDriver(flag),
      resolveConfig: (id) => configs.get(id) ?? null,
    });
    // 第一次：第一页写入后源端第二页查询抛错 → 中途失败
    await expect(flakyEngine.migrate(request({ tables: ['items'], batchSize: 20 }))).rejects.toThrow(
      /模拟源端中途失败/,
    );

    const partial = Number((await readTarget<{ c: number }>('SELECT COUNT(*) AS c FROM items'))[0]?.['c']);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(120);

    // 第二次：目标表已有部分数据。旧逻辑会"整表跳过"并报 success，实际永久缺数据。
    flag.on = false;
    const second = await engine.migrate(
      request({ tables: ['items'], batchSize: 20, conflictStrategy: 'skip' }),
    );
    expect(second.status).toBe('success');
    expect(second.failedRows).toBe(0);

    const finalCount = Number((await readTarget<{ c: number }>('SELECT COUNT(*) AS c FROM items'))[0]?.['c']);
    expect(finalCount).toBe(120);

    const src = await readFrom<{ id: number; payload: string }>(
      SOURCE_ID,
      'SELECT id, payload FROM items ORDER BY id',
    );
    const dst = await readTarget<{ id: number; payload: string }>(
      'SELECT id, payload FROM items ORDER BY id',
    );
    expect(dst).toEqual(src);
  });

  it('无主键且目标非空时整表跳过：状态为 skipped 并写明原因（不报 success）', async () => {
    const registry = createDefaultRegistry();
    const source = await registry.require('sqlite').connect(configs.get(SOURCE_ID) as ConnectionConfig);
    const exec = source.getQueryExecutor();
    await exec.execute('CREATE TABLE logs (message TEXT, level TEXT);');
    for (let i = 0; i < 25; i++) {
      await exec.execute('INSERT INTO logs (message, level) VALUES (?, ?)', {
        params: [`m${i}`, i % 2 === 1 ? 'warn' : 'info'],
      });
    }
    await source.close();

    await engine.migrate(request({ tables: ['logs'], batchSize: 4 }));
    const again = await engine.migrate(request({ tables: ['logs'], batchSize: 4, conflictStrategy: 'skip' }));

    expect(again.status).toBe('skipped');
    const report = again.tables.find((t) => t.table === 'logs');
    expect(report?.status).toBe('skipped');
    expect(report?.skippedRows).toBe(25);
    expect(report?.message).toMatch(/没有主键/);

    const count = Number((await readTarget<{ c: number }>('SELECT COUNT(*) AS c FROM logs'))[0]?.['c']);
    expect(count).toBe(25);
  });
});

describe('迁移模式（缺陷回归）', () => {
  it('incremental / sync 显式拒绝，绝不静默按全量执行', async () => {
    await expect(engine.migrate(request({ mode: 'incremental' }))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(engine.migrate(request({ mode: 'sync' }))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // 拒绝必须发生在任何写入之前
    const tables = await readTarget<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','orders')",
    );
    expect(tables).toHaveLength(0);
  });

  it('sync() 入口同样显式拒绝（cursorColumn/since 尚未实现）', async () => {
    await expect(
      engine.sync({ ...request(), cursorColumn: 'updated_at', since: '2026-01-01T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('precheck 对非 full 模式给出 error', async () => {
    const result = await engine.precheck(request({ mode: 'incremental' }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.level === 'error')).toBe(true);
  });
});

describe('取消', () => {
  it('取消后再调用不会继续写数据', async () => {
    engine.cancel(String(request().id ?? '')); // 不存在的 id：无副作用
    const result = await engine.migrate(request());
    expect(result.status).toBe('success');
  });
});
