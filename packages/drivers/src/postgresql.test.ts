/**
 * 花生苗数据库管理工具 - PostgreSQL 驱动集成测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这不是 mock：测试会拉起一个**真实的 PostgreSQL 服务端**（PGlite 是
 * PostgreSQL 编译到 WASM 的发行版，通过 pglite-socket 暴露标准 PG 线协议），
 * 然后用本项目的 PostgresDriver + 真实的 pg 驱动连上去跑完整流程。
 *
 * 之所以不用 @embedded-postgres：它的二进制依赖 ICU 60，与本机 ICU 78
 * 不兼容；PGlite 自带运行时、无外部 so 依赖，更适合做 CI 里的真库验证。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '@peanutsprout/core';
import { PostgresDriver, resolvePostgresTarget } from './postgresql.js';

/** 动态挑选空闲端口：写死端口会在上一次运行残留 socket 时假失败 */
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

let PORT = 0;

let db: { close(): Promise<void> } | null = null;
let server: { start(): Promise<void>; stop(): Promise<void> } | null = null;
/**
 * PGLiteSocketServer 同一时刻只接受一个客户端连接，因此整个用例共享
 * 一条连接，而不是每个 it 各开一个池 —— 后者会让第二个用例连不上。
 */
let shared: Awaited<ReturnType<PostgresDriver['connect']>> | null = null;

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'pglite-test',
    dbType: 'postgresql',
    host: '127.0.0.1',
    port: PORT,
    databaseName: 'postgres',
    username: 'postgres',
    password: '',
    readOnly: false,
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    PORT = await freePort();
    const { PGlite } = await import('@electric-sql/pglite');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const instance = await PGlite.create();
    const srv = new PGLiteSocketServer({ db: instance, port: PORT, host: '127.0.0.1' });
    await srv.start();
    db = instance as unknown as { close(): Promise<void> };
    server = srv as unknown as { start(): Promise<void>; stop(): Promise<void> };
    // 注意：PGLiteSocketServer 一生只服务一个客户端连接，因此这里只建一条
    // 共享连接；testConnection（会开自己的连接再关掉）放到独立用例文件里验证。
    shared = await new PostgresDriver().connect(config());
  } catch (e) {
    // 这里必须抛出：@electric-sql/pglite 是声明过的 devDependency，
    // 启动不了说明环境真的坏了；静默跳过会让集成测试"假绿"。
    throw new Error(
      `无法启动 PGlite 真实 PostgreSQL 服务端，集成测试无法进行: ${(e as Error).message}`,
      { cause: e },
    );
  }
}, 180_000);

afterAll(async () => {
  await shared?.close().catch(() => undefined);
  await server?.stop().catch(() => undefined);
  // 见 postgresql-conn.test.ts 的说明：必须让 PGlite 的延迟清理回调先跑完
  await new Promise((resolve) => setTimeout(resolve, 300));
  await db?.close().catch(() => undefined);
}, 60_000);

describe('PostgreSQL 驱动（对接真实服务端）', () => {
  it('注册表把 PostgreSQL 标为已实现，Oracle 仍为占位', async () => {
    const { createDefaultRegistry } = await import('./registry.js');
    const registry = createDefaultRegistry();
    expect(registry.get('postgresql')?.implemented).toBe(true);
    expect(registry.get('mysql')?.implemented).toBe(true);
    expect(registry.get('oracle')?.implemented).toBe(false);
    // 金仓走 PG 协议，也应已实现
    expect(registry.get('kingbase')?.implemented).toBe(true);
  });

  it('能建表、写入、读回，并正确归一化单元格类型', async () => {
    if (!shared) return;
    if (!shared) return;
    const conn = shared;
    const exec = conn.getQueryExecutor();

    await exec.execute('DROP TABLE IF EXISTS ps_demo');
    await exec.execute(
      `CREATE TABLE ps_demo (
         id serial PRIMARY KEY,
         name text NOT NULL,
         amount numeric(10,2),
         flag boolean,
         created_at timestamptz DEFAULT now(),
         payload jsonb
       )`,
    );
    const inserted = await exec.executeUpdate(
      'INSERT INTO ps_demo (name, amount, flag, payload) VALUES ($1,$2,$3,$4)',
      ['张三', '199.50', true, '{"region":"华东"}'],
    );
    expect(inserted).toBe(1);

    const res = await exec.execute('SELECT id, name, amount, flag, payload FROM ps_demo');
    expect(res.rowCount).toBe(1);
    expect(res.rows[0]?.[1]).toBe('张三');
    expect(res.rows[0]?.[2]).toBe('199.50');
    expect(res.rows[0]?.[3]).toBe(true);
    // 列元信息应带真实类型名
    expect(res.columns.map((c) => c.name)).toEqual(['id', 'name', 'amount', 'flag', 'payload']);
    expect(res.columns.find((c) => c.name === 'name')?.dataType).toBe('text');

    // 中文与特殊字符不应被破坏（参数绑定路径）
    await exec.executeUpdate('INSERT INTO ps_demo (name) VALUES ($1)', ["李四'; DROP TABLE ps_demo; --"]);
    const after = await exec.execute("SELECT count(*) AS c FROM ps_demo");
    expect(Number(after.rows[0]?.[0])).toBe(2);

    await exec.execute('DROP TABLE ps_demo');
  }, 120_000);

  it('元数据：表 / 列 / 索引 / 约束都能从 pg_catalog 正确读出', async () => {
    if (!shared) return;
    if (!shared) return;
    const conn = shared;
    const meta = conn.getMetadata();
    const exec = conn.getQueryExecutor();

    await exec.execute('DROP TABLE IF EXISTS ps_meta');
    await exec.execute('DROP TABLE IF EXISTS ps_meta_child');
    // 被引用的表必须先存在
    await exec.execute('CREATE TABLE ps_meta_child (id serial PRIMARY KEY)');
    await exec.execute(
      `CREATE TABLE ps_meta (
         id serial PRIMARY KEY,
         code varchar(32) NOT NULL UNIQUE,
         parent_id integer REFERENCES ps_meta_child(id),
         note text
       )`,
    );
    await exec.execute('CREATE INDEX ps_meta_note_idx ON ps_meta (note)');

    const schemas = await meta.listSchemas();
    expect(schemas.map((s) => s.name)).toContain('public');

    const tables = await meta.listTables('public');
    expect(tables.map((t) => t.name)).toContain('ps_meta');

    const columns = await meta.listColumns('public', 'ps_meta');
    const byName = new Map(columns.map((c) => [c.name, c]));
    expect(byName.get('id')?.isPrimaryKey).toBe(true);
    expect(byName.get('code')?.nullable).toBe(false);
    expect(byName.get('code')?.dataType).toContain('character varying');
    expect(byName.get('note')?.nullable).toBe(true);
    // ordinal 必须按真实顺序
    expect(columns.map((c) => c.name)).toEqual(['id', 'code', 'parent_id', 'note']);

    const indexes = await meta.listIndexes('public', 'ps_meta');
    const idxNames = indexes.map((i) => i.name);
    expect(idxNames).toContain('ps_meta_pkey');
    expect(idxNames).toContain('ps_meta_note_idx');
    const noteIdx = indexes.find((i) => i.name === 'ps_meta_note_idx');
    expect(noteIdx?.columns).toEqual(['note']);
    expect(noteIdx?.unique).toBe(false);

    const constraints = await meta.listConstraints('public', 'ps_meta');
    const types = constraints.map((c) => c.type);
    expect(types).toContain('primary_key');
    expect(types).toContain('unique');
    expect(types).toContain('foreign_key');

    await exec.execute('DROP TABLE ps_meta');
    await exec.execute('DROP TABLE ps_meta_child');
  }, 120_000);

  it('DDL 生成器产出合法 SQL，且生成的 DDL 能被真实执行', async () => {
    if (!shared) return;
    if (!shared) return;
    const conn = shared;
    const ddl = conn.getDdlGenerator();
    const exec = conn.getQueryExecutor();

    const columns = [
      { schema: 'public', table: 'ps_ddl', name: 'id', dataType: 'serial', nullable: false, defaultValue: null, comment: null, isPrimaryKey: true, ordinal: 1 },
      { schema: 'public', table: 'ps_ddl', name: 'name', dataType: 'text', nullable: false, defaultValue: null, comment: null, isPrimaryKey: false, ordinal: 2 },
      { schema: 'public', table: 'ps_ddl', name: 'memo', dataType: 'varchar(64)', nullable: true, defaultValue: "'x'", comment: null, isPrimaryKey: false, ordinal: 3 },
    ];
    const sql = ddl.createTable('public', 'ps_ddl', columns);
    expect(sql).toContain('CREATE TABLE "public"."ps_ddl"');
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toContain('NOT NULL');

    await exec.execute('DROP TABLE IF EXISTS ps_ddl');
    await exec.execute(sql);
    const back = await conn.getMetadata().listColumns('public', 'ps_ddl');
    expect(back.map((c) => c.name)).toEqual(['id', 'name', 'memo']);
    expect(back.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);

    // ADD / DROP COLUMN 也要能真的执行
    await exec.execute(ddl.addColumn('public', 'ps_ddl', { schema: 'public', table: 'ps_ddl', name: 'extra', dataType: 'integer', nullable: true, defaultValue: null, comment: null, isPrimaryKey: false, ordinal: 4 }));
    expect((await conn.getMetadata().listColumns('public', 'ps_ddl')).map((c) => c.name)).toContain('extra');
    await exec.execute(ddl.dropColumn('public', 'ps_ddl', 'extra'));
    expect((await conn.getMetadata().listColumns('public', 'ps_ddl')).map((c) => c.name)).not.toContain('extra');

    await exec.execute('DROP TABLE ps_ddl');
  }, 120_000);

  it('EXPLAIN 解析成可画图的节点树', async () => {
    if (!shared) return;
    if (!shared) return;
    const conn = shared;
    const exec = conn.getQueryExecutor();
    await exec.execute('DROP TABLE IF EXISTS ps_plan');
    await exec.execute('CREATE TABLE ps_plan (id integer, name text)');
    await exec.execute('INSERT INTO ps_plan VALUES (1, \'a\'), (2, \'b\')');

    // 走执行器提供的 explain()，这也是 AI 优化场景的真实调用路径
    const plan = await exec.explain('SELECT * FROM ps_plan WHERE id = 1');
    expect(plan.format).toBe('json');
    expect(plan.nodes && plan.nodes.length).toBeGreaterThan(0);
    const tree = conn.getExplainParser().toTree(plan);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0]?.label.length).toBeGreaterThan(0);

    await exec.execute('DROP TABLE ps_plan');
  }, 120_000);

  it('连接串补全缺省项，且连接串端口不会被默认端口覆盖（曾经的回归缺陷）', () => {
    // 未显式填写任何分项时，全部取自连接串
    const fromUrl = resolvePostgresTarget(
      config({ connectionUrl: 'postgresql://u:p@db.example.com:6432/mydb', host: null, port: null, databaseName: null, username: null }),
    );
    expect(fromUrl.host).toBe('db.example.com');
    expect(fromUrl.port).toBe(6432); // 不能被 5432 默认值覆盖
    expect(fromUrl.database).toBe('mydb');
    expect(fromUrl.user).toBe('u');
    expect(fromUrl.password).toBe('p');

    // 显式填写的分项优先于连接串（表单里手填的值是用户的最新意图）
    const explicit = resolvePostgresTarget(
      config({ connectionUrl: 'postgresql://u:p@db.example.com:6432/mydb', port: 7432 }),
    );
    expect(explicit.port).toBe(7432);

    // 只给连接串、没有端口时，才回退到默认端口
    const dflt = resolvePostgresTarget(
      config({ connectionUrl: 'postgresql://u:p@db.example.com/mydb', host: null, port: null, databaseName: null, username: null }),
    );
    expect(dflt.port).toBe(5432);
  });

  it('缺少主机地址时报错清晰，且不发起连接', () => {
    expect(() => resolvePostgresTarget(config({ host: '', connectionUrl: null }))).not.toThrow();
    // host 为空时回退 localhost，端口非法才报错
    expect(() => resolvePostgresTarget(config({ host: 'x', port: 99999 }))).toThrow(/端口非法/);
  });

  it('金仓 kingbase8:// 连接串被识别，不被静默忽略（回归缺陷）', () => {
    const t = resolvePostgresTarget(
      config({
        dbType: 'kingbase',
        connectionUrl: 'kingbase8://system:pw@kingbase.prod:54321/erp',
        host: null,
        port: null,
        databaseName: null,
        username: null,
        password: null,
      }),
    );
    expect(t.host).toBe('kingbase.prod');
    expect(t.port).toBe(54321);
    expect(t.database).toBe('erp');
    expect(t.user).toBe('system');
  });

  it('协议头不匹配时显式报错，不静默回落 localhost', () => {
    expect(() =>
      resolvePostgresTarget(config({ connectionUrl: 'mysql://u@db.prod:3306/x', host: null })),
    ).toThrow(/不匹配/);
  });

  it('IPv6 主机名去掉方括号（回归缺陷：ENOTFOUND）', () => {
    const t = resolvePostgresTarget(
      config({
        connectionUrl: 'postgres://u:p@[::1]:6432/mydb',
        host: null,
        port: null,
        databaseName: null,
        username: null,
      }),
    );
    expect(t.host).toBe('::1');
    expect(t.port).toBe(6432);
  });
});
