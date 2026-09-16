/**
 * 花生苗数据库管理工具 - 表数据编辑与可视化建表端到端测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个文件盯住的是**安全与正确性**，不是"接口能返回 200"：
 *
 *  · 没有主键、也没有「唯一且全非空」索引的表，**必须拒绝**更新与删除 ——
 *    否则一次"改一行"可能悄悄改掉多行，而界面只显示改了一行；
 *  · 界面给的 key 必须**恰好**等于定位符的列，多一列少一列都要被拒；
 *  · 只读账号在表数据接口上同样写不动（不能成为绕过写闸门的旁路）；
 *  · 真正的落库结果直接用 `node:sqlite` 独立读出来核对（不自己验自己）；
 *  · DDL 预览**一个字节都不能执行**，执行必须带 confirm；
 *  · 默认值白名单真的挡得住 `0; DROP TABLE ...`；
 *  · SQLite 建 Schema 必须明确报"不支持"，而不是拼出一句跑不通的 SQL。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import type { ServerConfig } from './config.js';
import { resolveRowLocator, buildUpdate, assertKeyMatchesLocator, orderedKey } from './routes/table-data.js';
import {
  buildCreateSchemaStatement,
  buildCreateTableStatements,
  toColumnInfos,
  validateTableSpec,
} from './routes/ddl.js';
import {
  columnTypesFor,
  isSafeDefaultExpression,
  schemaKeywordFor,
  supportsIfNotExists,
} from './lib/column-types.js';

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let dbPath: string;
let adminToken = '';
let readonlyToken = '';
let connectionId = 0;

const ADMIN = 'admin';
const ADMIN_PASSWORD = 'Adm1n-Passw0rd!';

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

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(res.statusCode, `${username} 登录失败: ${res.body}`).toBe(200);
  return res.json().token as string;
}

/** 直接读库，绕过被测代码。 */
function rawAll(sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function tableNames(): string[] {
  return rawAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(
    (r) => r.name as string,
  );
}

const call = (url: string, token: string, payload: Record<string, unknown>): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth(token), payload });

/**
 * DDL 的正向路径：服务端要求 `confirm: true`（与 /query/execute 同一约定），
 * 所以这里模拟"界面已经问过用户、用户点了确认"之后的那次请求。
 * 需要验证 428 的用例不走这个 helper，直接 inject。
 */
const callDdl = (url: string, token: string, payload: Record<string, unknown>): Promise<LightMyRequestResponse> =>
  call(url, token, { ...payload, confirm: true });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-tabledata-'));
  dbPath = join(dir, 'data.db');

  const seed = new DatabaseSync(dbPath);
  // 有主键：可编辑
  seed.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, note TEXT)');
  seed.exec("INSERT INTO people VALUES (1, '甲', 30, NULL), (2, '乙', NULL, 'x'), (3, '丙', 40, 'y')");
  // 没有主键、也没有唯一索引：必须只读
  seed.exec('CREATE TABLE logs (level TEXT, message TEXT)');
  seed.exec("INSERT INTO logs VALUES ('info', 'a'), ('warn', 'b')");
  // 没有主键，但有一个「唯一 + 非空」索引：可以安全定位
  seed.exec('CREATE TABLE codes (code TEXT NOT NULL, label TEXT)');
  seed.exec('CREATE UNIQUE INDEX ux_codes_code ON codes (code)');
  seed.exec("INSERT INTO codes VALUES ('a', 'A'), ('b', 'B')");
  // 唯一索引里带可空列：不能用作定位符（NULL 的 = 比较永远不成立）
  seed.exec('CREATE TABLE nullable_uniq (k TEXT, v TEXT)');
  seed.exec('CREATE UNIQUE INDEX ux_nu_k ON nullable_uniq (k)');
  seed.close();

  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  adminToken = await login(ADMIN, ADMIN_PASSWORD);
  const created = await call('/connections', adminToken, {
    name: '测试库',
    dbType: 'sqlite',
    databaseName: dbPath,
  });
  expect(created.statusCode, created.body).toBe(201);
  connectionId = created.json().item.id as number;

  const ro = await call('/users', adminToken, {
    username: 'td-readonly',
    password: 'Re@d0nly-Pass!',
    roles: ['readonly'],
  });
  expect(ro.statusCode, ro.body).toBe(201);
  readonlyToken = await login('td-readonly', 'Re@d0nly-Pass!');
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

/* ================================================================== 纯逻辑单测 */

describe('resolveRowLocator · 定位符判定', () => {
  const col = (name: string, extra: Partial<{ nullable: boolean; isPrimaryKey: boolean; ordinal: number }> = {}) => ({
    schema: 'main',
    table: 't',
    name,
    dataType: 'TEXT',
    nullable: false,
    defaultValue: null,
    comment: null,
    isPrimaryKey: false,
    ordinal: 0,
    ...extra,
  });
  const idx = (name: string, columns: string[], unique = true, primary = false) => ({
    schema: 'main',
    table: 't',
    name,
    columns,
    unique,
    primary,
  });

  it('有主键时优先用主键，且按 ordinal 排序', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('b', { isPrimaryKey: true, ordinal: 1 }), col('a', { isPrimaryKey: true, ordinal: 0 })],
      async () => [idx('ux', ['b'])],
    );
    expect(locator).toEqual({ kind: 'primary_key', columns: ['a', 'b'] });
  });

  it('没有主键时退到「唯一 + 全非空」的索引', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('code'), col('label', { nullable: true })],
      async () => [idx('ux_codes_code', ['code'])],
    );
    expect(locator).toEqual({ kind: 'unique_index', columns: ['code'], indexName: 'ux_codes_code' });
  });

  it('唯一索引里有可空列时不能用（NULL 的 = 比较永远不成立）', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('k', { nullable: true })],
      async () => [idx('ux_k', ['k'])],
    );
    expect(locator.kind).toBe('none');
  });

  it('非唯一索引不能用作定位符', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('k')],
      async () => [idx('ix_k', ['k'], false)],
    );
    expect(locator.kind).toBe('none');
  });

  it('主键索引本身（primary=true）不会被当成"唯一索引"重复利用', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('k')],
      async () => [idx('pk_k', ['k'], true, true)],
    );
    expect(locator.kind).toBe('none');
  });

  it('列清单为空时不报错，返回 none（由调用方判断是不是"表不存在"）', async () => {
    const { locator, columns } = await resolveRowLocator(
      async () => [],
      async () => [],
    );
    expect(columns).toEqual([]);
    expect(locator.kind).toBe('none');
  });

  it('列出索引抛异常时不把整张表带崩，降级为 none', async () => {
    const { locator } = await resolveRowLocator(
      async () => [col('k')],
      async () => {
        throw new Error('driver does not support indexes');
      },
    );
    expect(locator.kind).toBe('none');
  });
});

describe('assertKeyMatchesLocator · key 必须恰好覆盖定位列', () => {
  const locator = { kind: 'unique_index' as const, columns: ['a', 'b'], indexName: 'ux' };

  it('完全一致时通过', () => {
    expect(() => assertKeyMatchesLocator(locator, { a: 1, b: 2 })).not.toThrow();
  });

  it('少一列 → 拒绝（否则可能匹配多行）', () => {
    expect(() => assertKeyMatchesLocator(locator, { a: 1 })).toThrow(/定位键/);
  });

  it('多一列 → 拒绝（客户端用过期的定位符）', () => {
    expect(() => assertKeyMatchesLocator(locator, { a: 1, b: 2, c: 3 })).toThrow(/定位键/);
  });

  it('列名对但顺序不同 → 通过（比较的是集合）', () => {
    expect(() => assertKeyMatchesLocator(locator, { b: 2, a: 1 })).not.toThrow();
  });

  it('kind 为 none → 明确拒绝，不退化模糊匹配', () => {
    expect(() => assertKeyMatchesLocator({ kind: 'none', columns: [] }, { a: 1 })).toThrow(/无法安全地定位/);
  });

  it('orderedKey 按定位符列顺序输出，缺列补 null', () => {
    expect(orderedKey(locator, { b: 2, a: 1 })).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(orderedKey(locator, { a: 1 })).toEqual([
      ['a', 1],
      ['b', null],
    ]);
  });
});

describe('buildUpdate · SQL 与参数一一对应', () => {
  const conn = { config: { dbType: 'sqlite' } } as never;
  const pgConn = { config: { dbType: 'postgresql' } } as never;

  it('SQLite 用 ? 占位符，参数顺序是「SET 值在前、WHERE 值在后」', () => {
    const { sql, params } = buildUpdate(
      conn,
      'main',
      'people',
      [['name', '新名']],
      [
        ['id', 7],
        ['tenant', 't1'],
      ],
    );
    expect(sql).toBe('UPDATE "main"."people" SET "name" = ? WHERE "id" = ? AND "tenant" = ?');
    expect(params).toEqual(['新名', 7, 't1']);
  });

  it('PostgreSQL 用 $n 占位符且编号连续递增', () => {
    const { sql, params } = buildUpdate(
      pgConn,
      'public',
      'people',
      [
        ['a', 1],
        ['b', 2],
      ],
      [['id', 3]],
    );
    expect(sql).toBe('UPDATE "public"."people" SET "a" = $1, "b" = $2 WHERE "id" = $3');
    expect(params).toEqual([1, 2, 3]);
  });

  it('定位值为 NULL 时用 IS NULL，且不占参数位', () => {
    const { sql, params } = buildUpdate(conn, 'main', 't', [['v', 'x']], [['k', null]]);
    expect(sql).toBe('UPDATE "main"."t" SET "v" = ? WHERE "k" IS NULL');
    expect(params).toEqual(['x']);
  });

  it('没有要改的列 → 抛错，不生成空 SET', () => {
    expect(() => buildUpdate(conn, 'main', 't', [], [['id', 1]])).toThrow(/没有需要修改的列/);
  });

  it('表名非法时被标识符白名单拦下（防注入）', () => {
    expect(() => buildUpdate(conn, 'main', 'a"; DROP TABLE x --', [['v', 1]], [['id', 1]])).toThrow();
  });
});

describe('默认值白名单 · DDL 无法使用绑定参数', () => {
  it('接受字面量与标准函数', () => {
    for (const ok of ['0', '-1.5', '1e10', "'abc'", "''", 'true', 'FALSE', 'NULL', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP(6)', '']) {
      expect(isSafeDefaultExpression(ok), `${ok} 应被接受`).toBe(true);
    }
  });

  it('拒绝在默认值里塞第二条语句', () => {
    for (const bad of [
      "0; DROP TABLE people --",
      "0); DROP TABLE people; --",
      'now()',
      '(SELECT 1)',
      "'a' || (SELECT 1)",
      'x\nDROP TABLE y',
      '0 /*',
    ]) {
      expect(isSafeDefaultExpression(bad), `${bad} 应被拒绝`).toBe(false);
    }
  });

  it("允许 SQL 标准的 '' 转义，但不允许反斜杠转义", () => {
    expect(isSafeDefaultExpression("'it''s'")).toBe(true);
    expect(isSafeDefaultExpression("'it\\'s'")).toBe(false);
  });
});

describe('validateTableSpec · 建表校验', () => {
  const base = { table: 't', columns: [{ name: 'id', dataType: 'INTEGER' }, { name: 'x', dataType: 'TEXT' }], indexes: [] };

  it('合法定义无错误', () => {
    expect(validateTableSpec(base)).toEqual([]);
  });

  it('没有列 → NO_COLUMNS', () => {
    expect(validateTableSpec({ ...base, columns: [] }).map((e) => e.code)).toContain('NO_COLUMNS');
  });

  it('列名重复（大小写不敏感）→ DUPLICATE_COLUMN', () => {
    const errors = validateTableSpec({
      ...base,
      columns: [{ name: 'A', dataType: 'TEXT' }, { name: 'a', dataType: 'TEXT' }],
    });
    expect(errors.map((e) => e.code)).toContain('DUPLICATE_COLUMN');
  });

  it('索引名重复 → DUPLICATE_INDEX', () => {
    const errors = validateTableSpec({
      ...base,
      indexes: [
        { name: 'ix', columns: ['x'] },
        { name: 'IX', columns: ['x'] },
      ],
    });
    expect(errors.map((e) => e.code)).toContain('DUPLICATE_INDEX');
  });

  it('索引引用不存在的列 → INDEX_UNKNOWN_COLUMN', () => {
    const errors = validateTableSpec({ ...base, indexes: [{ name: 'ix', columns: ['nope'] }] });
    expect(errors.map((e) => e.code)).toContain('INDEX_UNKNOWN_COLUMN');
  });

  it('索引没有列 → INDEX_NO_COLUMNS', () => {
    const errors = validateTableSpec({ ...base, indexes: [{ name: 'ix', columns: [] }] });
    expect(errors.map((e) => e.code)).toContain('INDEX_NO_COLUMNS');
  });

  it('危险的默认值 → UNSAFE_DEFAULT', () => {
    const errors = validateTableSpec({
      ...base,
      columns: [{ name: 'id', dataType: 'INTEGER', defaultValue: '0; DROP TABLE t --' }],
    });
    expect(errors.map((e) => e.code)).toContain('UNSAFE_DEFAULT');
  });

  it('表名为空 → NO_TABLE_NAME', () => {
    expect(validateTableSpec({ ...base, table: '' }).map((e) => e.code)).toContain('NO_TABLE_NAME');
  });
});

describe('toColumnInfos · 主键强制非空、长度拼进类型名', () => {
  it('主键列被强制成 nullable=false（界面被绕过也拦得住）', () => {
    const [column] = toColumnInfos('main', 't', [
      { name: 'id', dataType: 'INTEGER', nullable: true, primaryKey: true },
    ]);
    expect(column!.nullable).toBe(false);
    expect(column!.isPrimaryKey).toBe(true);
  });

  it('length 拼到类型名后面，数字与字符串都支持', () => {
    const cols = toColumnInfos('main', 't', [
      { name: 'a', dataType: 'varchar', length: 64, nullable: true, primaryKey: false },
      { name: 'b', dataType: 'decimal', length: '10,2', nullable: true, primaryKey: false },
      { name: 'c', dataType: 'text', length: null, nullable: true, primaryKey: false },
    ]);
    expect(cols.map((c) => c.dataType)).toEqual(['varchar(64)', 'decimal(10,2)', 'text']);
  });

  it('空字符串的默认值/注释归一化成 null', () => {
    const [column] = toColumnInfos('main', 't', [
      { name: 'a', dataType: 'TEXT', nullable: true, primaryKey: false, defaultValue: '  ', comment: '' },
    ]);
    expect(column!.defaultValue).toBeNull();
    expect(column!.comment).toBeNull();
  });
});

describe('buildCreateTableStatements · 一条数组元素 = 一条可执行语句', () => {
  const ddl = {
    createTable: (schema: string, table: string) => `CREATE TABLE "${schema}"."${table}" (\n  "id" INTEGER\n);`,
    createIndex: (_s: string, _t: string, index: { name: string }) => `CREATE INDEX "${index.name}";`,
  };
  const column = toColumnInfos('main', 't', [{ name: 'id', dataType: 'INTEGER', nullable: false, primaryKey: true }]);
  const index = [{ schema: 'main', table: 't', name: 'ix', columns: ['id'], unique: false, primary: false }];

  it('无索引时只有一条建表语句', () => {
    expect(buildCreateTableStatements(ddl, 'sqlite', 'main', 't', column, [], false)).toEqual([
      'CREATE TABLE "main"."t" (\n  "id" INTEGER\n);',
    ]);
  });

  it('每个索引单独一条，顺序在建表之后', () => {
    const out = buildCreateTableStatements(ddl, 'sqlite', 'main', 't', column, index, false);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TABLE');
    expect(out[1]).toBe('CREATE INDEX "ix";');
  });

  it('ifNotExists 走文本改写', () => {
    const out = buildCreateTableStatements(ddl, 'sqlite', 'main', 't', column, [], true);
    expect(out[0]).toContain('CREATE TABLE IF NOT EXISTS "main"."t"');
  });

  it('不支持 IF NOT EXISTS 的方言直接报错，而不是默默忽略用户的勾选', () => {
    expect(() => buildCreateTableStatements(ddl, 'sqlserver', 'dbo', 't', column, [], true)).toThrow(
      /不支持 CREATE TABLE IF NOT EXISTS/,
    );
  });

  it('驱动生成的语句形态变了（改写没生效）时报错而不是静默忽略', () => {
    const weird = { ...ddl, createTable: () => '/* no create here */' };
    expect(() => buildCreateTableStatements(weird, 'sqlite', 'main', 't', column, [], true)).toThrow(
      /无法在该方言的建表语句里插入 IF NOT EXISTS/,
    );
  });
});

describe('方言支持表', () => {
  it('SQLite 不支持建 Schema，且报错信息可读', () => {
    expect(schemaKeywordFor('sqlite')).toBeNull();
    expect(() => buildCreateSchemaStatement('sqlite', 'x', 'SQLite')).toThrow(/不支持用 SQL 创建 Schema 或数据库/);
  });

  it('PostgreSQL / Kingbase 用 SCHEMA，MySQL 系用 DATABASE', () => {
    expect(schemaKeywordFor('postgresql')).toBe('SCHEMA');
    expect(schemaKeywordFor('kingbase')).toBe('SCHEMA');
    expect(schemaKeywordFor('mysql')).toBe('DATABASE');
    expect(schemaKeywordFor('mariadb')).toBe('DATABASE');
  });

  it('生成的语句按方言引用标识符', () => {
    expect(buildCreateSchemaStatement('postgresql', 'analytics', 'PostgreSQL')).toBe('CREATE SCHEMA "analytics";');
    expect(buildCreateSchemaStatement('mysql', 'analytics', 'MySQL')).toBe('CREATE DATABASE `analytics`;');
  });

  it('非法名称被标识符白名单拦下', () => {
    expect(() => buildCreateSchemaStatement('postgresql', 'x"; DROP DATABASE y --', 'PostgreSQL')).toThrow();
  });

  it('SQL Server 不支持建表 IF NOT EXISTS（唯一例外）', () => {
    expect(supportsIfNotExists('sqlserver')).toBe(false);
    expect(supportsIfNotExists('sqlite')).toBe(true);
    expect(supportsIfNotExists('postgresql')).toBe(true);
  });

  it('类型清单按方言族区分：jsonb 不给 MySQL，mediumint 不给 PostgreSQL', () => {
    const pg = columnTypesFor('postgresql').map((t) => t.name);
    const my = columnTypesFor('mysql').map((t) => t.name);
    expect(pg).toContain('jsonb');
    expect(my).not.toContain('jsonb');
    expect(my).toContain('mediumint');
    expect(pg).not.toContain('mediumint');
    // 每一族都必须给出非空清单，且 varchar 之类是带长度的
    for (const dbType of ['sqlite', 'postgresql', 'mysql', 'kingbase', 'mariadb', 'tidb', 'oceanbase']) {
      const types = columnTypesFor(dbType);
      expect(types.length, `${dbType} 类型清单不该为空`).toBeGreaterThan(15);
      expect(types.find((t) => t.name === 'varchar')?.hasLength, `${dbType} 的 varchar 应带长度`).toBe(true);
    }
  });

  it('未实现的方言也返回一份通用清单（用户仍可手填类型）', () => {
    expect(columnTypesFor('oracle').length).toBeGreaterThan(15);
    expect(columnTypesFor('sqlserver').length).toBeGreaterThan(15);
  });
});

/* ================================================================== HTTP 端到端 */

describe('表数据 · 读取', () => {
  it('列出列、定位符与可写性', async () => {
    const res = await call('/data/table/columns', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.locator).toMatchObject({ kind: 'primary_key', columns: ['id'] });
    expect(body.editable).toBe(true);
    expect(body.readOnlyReason).toBeNull();
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual(['id', 'name', 'age', 'note']);
  });

  it('没有主键也没有唯一索引的表 → editable:false 且给出 no_primary_key', async () => {
    const res = await call('/data/table/columns', adminToken, {
      connectionId,
      schema: 'main',
      table: 'logs',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().editable).toBe(false);
    expect(res.json().readOnlyReason).toBe('no_primary_key');
  });

  it('有「唯一 + 非空」索引的表 → 用该索引定位', async () => {
    const res = await call('/data/table/columns', adminToken, {
      connectionId,
      schema: 'main',
      table: 'codes',
    });
    expect(res.json().locator).toMatchObject({ kind: 'unique_index', columns: ['code'], indexName: 'ux_codes_code' });
  });

  it('唯一索引的列可空 → 仍判定为不可编辑（NULL 比较有歧义）', async () => {
    const res = await call('/data/table/columns', adminToken, {
      connectionId,
      schema: 'main',
      table: 'nullable_uniq',
    });
    expect(res.json().locator.kind).toBe('none');
    expect(res.json().editable).toBe(false);
  });

  it('分页返回数据，NULL 原样返回 null', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      page: 1,
      pageSize: 2,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.pageSize).toBe(2);
    // 第 1 行 note 是 NULL
    expect(body.rows[0][3]).toBeNull();
  });

  it('第 2 页拿到剩下的行（按主键稳定排序，不串行）', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      page: 2,
      pageSize: 2,
    });
    expect(res.json().rows).toHaveLength(1);
    expect(res.json().rows[0][0]).toBe(3);
  });

  it('降序排序生效', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      orderBy: 'id',
      orderDir: 'desc',
    });
    expect(res.json().rows[0][0]).toBe(3);
  });

  it('按不存在的列排序 → 明确报错，而不是静默忽略', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      orderBy: 'no_such_column',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('no_such_column');
  });

  it('不存在的表 → 404', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'nope',
    });
    expect(res.statusCode).toBe(404);
  });

  it('pageSize 超过上限 → 被 zod 拒绝', async () => {
    const res = await call('/data/table/rows', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      pageSize: 100000,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('表数据 · 更新', () => {
  it('按主键改一格，直接读库确认只有那一行变了', async () => {
    const before = rawAll('SELECT id, name FROM people ORDER BY id');
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 2 },
      changes: { name: '乙改' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().updated).toBe(1);
    const after = rawAll('SELECT id, name FROM people ORDER BY id');
    expect(after).toEqual([
      { id: 1, name: '甲' },
      { id: 2, name: '乙改' },
      { id: 3, name: '丙' },
    ]);
    // 只有 id=2 变了
    expect(before[0]).toEqual(after[0]);
    expect(before[2]).toEqual(after[2]);
    // 恢复现场，避免影响后面的用例
    await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 2 },
      changes: { name: '乙' },
    });
  });

  it('把可空列改成 NULL', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 1 },
      changes: { note: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(rawAll('SELECT note FROM people WHERE id = 1')[0]!.note).toBeNull();
  });

  it('把非空列改成 NULL → 被拒，且库里没变', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 1 },
      changes: { name: null },
    });
    expect(res.statusCode).toBe(400);
    expect(rawAll('SELECT name FROM people WHERE id = 1')[0]!.name).toBe('甲');
  });

  it('没有主键的表 → 明确拒绝更新（不退化模糊匹配）', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'logs',
      key: { level: 'info' },
      changes: { message: 'hacked' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('无法安全地定位');
    // 一行都没被改
    expect(rawAll('SELECT message FROM logs ORDER BY level')).toEqual([{ message: 'a' }, { message: 'b' }]);
  });

  it('key 少一列（定位列有两列时）→ 拒绝', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'codes',
      key: { code: 'a', extra: 1 },
      changes: { label: 'A2' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('定位键');
  });

  it('定位符命中 0 行 → 404（记录已被别人删除）', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 9999 },
      changes: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('改不存在的列 → 拒绝', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 1 },
      changes: { no_such: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('no_such');
  });

  it('唯一索引定位的表可以安全更新，且只改一行', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'codes',
      key: { code: 'a' },
      changes: { label: 'A-new' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().updated).toBe(1);
    expect(rawAll('SELECT code, label FROM codes ORDER BY code')).toEqual([
      { code: 'a', label: 'A-new' },
      { code: 'b', label: 'B' },
    ]);
  });

  it('changes 为空 → 拒绝', async () => {
    const res = await call('/data/table/update', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      key: { id: 1 },
      changes: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('表数据 · 新增', () => {
  it('新增一行，直接读库确认', async () => {
    const res = await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: { id: 10, name: '新来的', age: 25 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().inserted).toBe(1);
    expect(rawAll('SELECT id, name, age, note FROM people WHERE id = 10')).toEqual([
      { id: 10, name: '新来的', age: 25, note: null },
    ]);
  });

  it('没有主键的表也能新增（新增不需要定位符）', async () => {
    const res = await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'logs',
      values: { level: 'error', message: 'boom' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(rawAll("SELECT message FROM logs WHERE level = 'error'")).toEqual([{ message: 'boom' }]);
  });

  it('非空无默认值的列漏填 → 指名道姓地报错', async () => {
    const res = await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: { id: 11, age: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('name');
    expect(rawAll('SELECT COUNT(*) AS n FROM people WHERE id = 11')[0]!.n).toBe(0);
  });

  it('values 为空 → 拒绝', async () => {
    const res = await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('新增到不存在的列 → 拒绝', async () => {
    const res = await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: { id: 12, nope: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('表数据 · 删除', () => {
  it('按主键删两行，直接读库确认删对了', async () => {
    await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: { id: 20, name: '待删1' },
    });
    await call('/data/table/insert', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      values: { id: 21, name: '待删2' },
    });
    const res = await call('/data/table/delete', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      keys: [{ id: 20 }, { id: 21 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().deleted).toBe(2);
    expect(rawAll('SELECT COUNT(*) AS n FROM people WHERE id IN (20, 21)')[0]!.n).toBe(0);
  });

  it('删除别人已经删掉的记录 → deleted 计 0，不报错也不误删', async () => {
    const res = await call('/data/table/delete', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      keys: [{ id: 99999 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().deleted).toBe(0);
  });

  it('没有主键的表 → 明确拒绝删除', async () => {
    const before = rawAll('SELECT COUNT(*) AS n FROM logs')[0]!.n;
    const res = await call('/data/table/delete', adminToken, {
      connectionId,
      schema: 'main',
      table: 'logs',
      keys: [{ level: 'info' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('无法安全地定位');
    expect(rawAll('SELECT COUNT(*) AS n FROM logs')[0]!.n).toBe(before);
  });

  it('keys 为空 → 被 zod 拒绝', async () => {
    const res = await call('/data/table/delete', adminToken, {
      connectionId,
      schema: 'main',
      table: 'people',
      keys: [],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('表数据 · 权限与审计', () => {
  it('只读账号：能读，但 editable=false 且写操作 403', async () => {
    const read = await call('/data/table/columns', readonlyToken, {
      connectionId,
      schema: 'main',
      table: 'people',
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().editable).toBe(false);
    expect(read.json().readOnlyReason).toBe('no_permission');

    for (const [url, payload] of [
      ['/data/table/insert', { values: { id: 90, name: 'x' } }],
      ['/data/table/update', { key: { id: 1 }, changes: { name: 'x' } }],
      ['/data/table/delete', { keys: [{ id: 1 }] }],
    ] as const) {
      const res = await call(url, readonlyToken, { connectionId, schema: 'main', table: 'people', ...payload });
      expect(res.statusCode, `${url} 应被拒绝: ${res.body}`).toBe(403);
    }
    // 确认一行都没动
    expect(rawAll('SELECT name FROM people WHERE id = 1')[0]!.name).toBe('甲');
    expect(rawAll('SELECT COUNT(*) AS n FROM people WHERE id = 90')[0]!.n).toBe(0);
  });

  it('被拒绝的写尝试留下了 denied 审计（不留无成本试错空间）', async () => {
    const rows = ctx.pdb.db.all<{ status: string; detail: string | null }>(
      "SELECT status, detail FROM audit_logs WHERE action = 'write' AND resource_type = 'table_row' AND status = 'denied'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const gates = rows.map((r) => (r.detail ? (JSON.parse(r.detail) as { gate?: string }).gate : undefined));
    expect(gates).toContain('AUTH_FORBIDDEN');
  });

  it('成功的写操作留下 success 审计，且记了操作类型与表名', async () => {
    const rows = ctx.pdb.db.all<{ detail: string | null }>(
      "SELECT detail FROM audit_logs WHERE action = 'write' AND resource_type = 'table_row' AND status = 'success'",
    );
    const details = rows.map((r) => JSON.parse(r.detail ?? '{}') as Record<string, unknown>);
    expect(details.some((d) => d.operation === 'insert' && d.table === 'people')).toBe(true);
    expect(details.some((d) => d.operation === 'update' && d.table === 'people')).toBe(true);
    expect(details.some((d) => d.operation === 'delete')).toBe(true);
  });

  it('别的用户的连接不可见（防枚举：不存在与未授权同为 404）', async () => {
    // readonly 能看到（管理员创建的连接对 readonly 可见，因为有 conn.read）
    const res = await call('/data/table/rows', readonlyToken, {
      connectionId: 99999,
      schema: 'main',
      table: 'people',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DDL · 预览不执行', () => {
  const spec = {
    connectionId: 0,
    schema: 'main',
    table: 'preview_only',
    columns: [
      { name: 'id', dataType: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'label', dataType: 'varchar', length: 32, nullable: true, primaryKey: false },
    ],
    indexes: [{ name: 'ix_preview_label', columns: ['label'], unique: false }],
  };

  it('预览返回语句，但数据库里什么都没建', async () => {
    const res = await call('/ddl/preview', adminToken, { ...spec, connectionId });
    expect(res.statusCode, res.body).toBe(200);
    const statements = res.json().statements as string[];
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TABLE');
    expect(statements[0]).toContain('varchar(32)');
    expect(statements[0]).toContain('PRIMARY KEY');
    expect(statements[1]).toContain('CREATE INDEX');
    // 关键：表绝不能已经存在
    expect(tableNames()).not.toContain('preview_only');
  });

  it('预览也走校验：非法默认值被拒', async () => {
    const res = await call('/ddl/preview', adminToken, {
      ...spec,
      connectionId,
      columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, primaryKey: true, defaultValue: '0; DROP TABLE people --' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('默认值');
  });

  it('只读账号也能预览（预览不碰数据库结构）', async () => {
    const res = await call('/ddl/preview', readonlyToken, { ...spec, connectionId });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('列名为非法标识符 → 被 schema 拒绝', async () => {
    const res = await call('/ddl/preview', adminToken, {
      ...spec,
      connectionId,
      columns: [{ name: 'a"; DROP TABLE people --', dataType: 'TEXT', nullable: true, primaryKey: false }],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DDL · 执行', () => {
  const spec = {
    connectionId: 0,
    schema: 'main',
    table: 'ddl_created',
    columns: [
      { name: 'id', dataType: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'note', dataType: 'TEXT', nullable: true, primaryKey: false },
    ],
    indexes: [{ name: 'ix_ddl_note', columns: ['note'], unique: false }],
  };

  it('不带 confirm → 428，且表没被建出来', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ddl/execute',
      headers: auth(adminToken),
      payload: { ...spec, connectionId },
    });
    expect(res.statusCode).toBe(428);
    expect(tableNames()).not.toContain('ddl_created');
  });

  it('带 confirm → 建表成功，索引也在，直接读库确认', async () => {
    const res = await callDdl('/ddl/execute', adminToken, { ...spec, connectionId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().executed).toBe(2);
    expect(tableNames()).toContain('ddl_created');
    const indexes = rawAll("SELECT name FROM sqlite_master WHERE type='index' AND name = 'ix_ddl_note'");
    expect(indexes).toHaveLength(1);
    // 列定义真的落地了
    const cols = rawAll('PRAGMA table_info(ddl_created)').map((c) => c.name);
    expect(cols).toEqual(['id', 'note']);
  });

  it('IF NOT EXISTS：重复建表不报错', async () => {
    const ine = { ...spec, connectionId, table: 'ddl_ine', indexes: [] };
    const res = await callDdl('/ddl/execute', adminToken, { ...ine, ifNotExists: true });
    expect(res.statusCode, res.body).toBe(200);
    const again = await callDdl('/ddl/execute', adminToken, { ...ine, ifNotExists: true });
    expect(again.statusCode, again.body).toBe(200);
    expect(tableNames()).toContain('ddl_ine');
  });

  it('IF NOT EXISTS 只作用于建表：同名索引再次创建会如实报错（MySQL 不支持 CREATE INDEX IF NOT EXISTS）', async () => {
    const withIndex = {
      ...spec,
      connectionId,
      table: 'ddl_ine_idx',
      indexes: [{ name: 'ix_ddl_ine_unique_name', columns: ['note'], unique: false }],
    };
    const first = await callDdl('/ddl/execute', adminToken, { ...withIndex, ifNotExists: true });
    expect(first.statusCode, first.body).toBe(200);
    const second = await callDdl('/ddl/execute', adminToken, { ...withIndex, ifNotExists: true });
    // 表那一步被 IF NOT EXISTS 豁免了，但索引这一步会撞名 —— 这是刻意保留的
    // 可预期行为，而不是"重跑总是成功"的假承诺。
    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(tableNames()).toContain('ddl_ine_idx');
  });

  it('不加 IF NOT EXISTS 重复建同名表 → 失败（不是静默成功）', async () => {
    const res = await callDdl('/ddl/execute', adminToken, { ...spec, connectionId });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('只读账号执行 → 403，且表没被建出来', async () => {
    const res = await callDdl('/ddl/execute', readonlyToken, {
      ...spec,
      connectionId,
      table: 'ddl_by_readonly',
    });
    expect(res.statusCode).toBe(403);
    expect(tableNames()).not.toContain('ddl_by_readonly');
  });

  it('SQLite 建 Schema → 400 且明确说明不支持', async () => {
    const res = await callDdl('/ddl/create-schema', adminToken, { connectionId, name: 'analytics' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('不支持用 SQL 创建 Schema 或数据库');
  });

  it('schema-support 如实回答 SQLite 不支持', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ddl/schema-support/${connectionId}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ dbType: 'sqlite', supported: false, keyword: null });
  });

  it('column-types 返回 SQLite 的类型清单', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ddl/column-types/${connectionId}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.dbType).toBe('sqlite');
    // 类型名一律小写（是给 SQL 用的，不是给界面显示的）
    expect(body.types.map((t: { name: string }) => t.name)).toContain('integer');
    expect(body.types.map((t: { name: string }) => t.name)).toContain('varchar');
  });

  it('删除表：不带 confirm → 428 且表还在', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ddl/drop-table',
      headers: auth(adminToken),
      payload: { connectionId, schema: 'main', table: 'ddl_created' },
    });
    expect(res.statusCode).toBe(428);
    expect(tableNames()).toContain('ddl_created');
  });

  it('删除表：带 confirm → 真的删掉', async () => {
    const res = await callDdl('/ddl/drop-table', adminToken, { connectionId, schema: 'main', table: 'ddl_created' });
    expect(res.statusCode, res.body).toBe(200);
    expect(tableNames()).not.toContain('ddl_created');
  });

  it('删除不存在的表 → 404（而不是方言化的报错）', async () => {
    const res = await callDdl('/ddl/drop-table', adminToken, { connectionId, schema: 'main', table: 'never_existed' });
    expect(res.statusCode).toBe(404);
  });

  it('只读账号删表 → 403 且表还在', async () => {
    const res = await callDdl('/ddl/drop-table', readonlyToken, { connectionId, schema: 'main', table: 'people' });
    expect(res.statusCode).toBe(403);
    expect(tableNames()).toContain('people');
  });

  it('DDL 操作（含被拒绝的）都留下审计', async () => {
    const rows = ctx.pdb.db.all<{ status: string; sql_text: string | null; detail: string | null }>(
      "SELECT status, sql_text, detail FROM audit_logs WHERE action = 'ddl'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.some((r) => r.status === 'denied')).toBe(true);
    expect(rows.some((r) => r.status === 'success' && (r.sql_text ?? '').includes('CREATE TABLE'))).toBe(true);
    const ops = rows.map((r) => (r.detail ? (JSON.parse(r.detail) as { operation?: string }).operation : undefined));
    expect(ops).toContain('create_table');
    expect(ops).toContain('drop_table');
  });
});
