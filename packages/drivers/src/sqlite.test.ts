/**
 * 花生苗数据库管理工具 - SQLite 驱动测试（真实数据库，非 mock）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这是本期唯一"已真实实现"的驱动，因此测试直接操作真实的 SQLite 文件，
 * 验证元数据读取、查询执行、参数绑定、只读保护与行数截断。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionConfig } from '@peanutsprout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { splitSqlStatements } from '@peanutsprout/core';
import { SqliteDriver, SqliteQueryExecutor } from './sqlite.js';

let dir: string;
let dbPath: string;

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'test',
    dbType: 'sqlite',
    databaseName: dbPath,
    readOnly: false,
    ...overrides,
  } as ConnectionConfig;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ps-sqlite-'));
  dbPath = join(dir, 'test.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  const conn = await new SqliteDriver().connect(config());
  const exec = conn.getQueryExecutor();
  await exec.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      score REAL,
      avatar BLOB
    );
  `);
  await exec.execute('CREATE INDEX idx_users_name ON users (name);');
  await exec.execute(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL
    );
  `);
  await exec.execute("INSERT INTO users (name, email, score) VALUES ('张三', 'a@b.com', 90.5)");
  await exec.execute("INSERT INTO users (name, email, score) VALUES ('李四', NULL, 77.25)");
  await exec.execute('INSERT INTO orders (user_id, amount) VALUES (1, 10.5), (2, 20.25)');
  await conn.close();
}

describe('连接与版本', () => {
  it('可以打开数据库并读取版本', async () => {
    const conn = await new SqliteDriver().connect(config());
    const { serverVersion } = await conn.ping();
    expect(serverVersion).toBeTruthy();
    await conn.close();
  });

  it('testConnection 返回成功与延迟', async () => {
    const result = await new SqliteDriver().testConnection(config());
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('testConnection 对无效路径返回失败而不是抛错', async () => {
    const result = await new SqliteDriver().testConnection(
      config({ databaseName: join(dir, 'nope', 'missing.db') }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it('缺少数据库路径时给出明确校验错误', async () => {
    await expect(
      new SqliteDriver().connect({ id: 1, name: 'x', dbType: 'sqlite', readOnly: false } as ConnectionConfig),
    ).rejects.toThrow(/文件路径/);
  });
});

describe('元数据读取', () => {
  beforeEach(seed);

  it('列出表并区分视图与表', async () => {
    const conn = await new SqliteDriver().connect(config());
    const tables = await conn.getMetadata().listTables('main');
    const names = tables.map((t) => t.name);
    expect(names).toContain('users');
    expect(names).toContain('orders');
    expect(tables.find((t) => t.name === 'users')?.kind).toBe('table');
    await conn.close();
  });

  it('读取列信息（类型、可空、主键、顺序）', async () => {
    const conn = await new SqliteDriver().connect(config());
    const columns = await conn.getMetadata().listColumns('main', 'users');
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'email', 'score', 'avatar']);
    expect(byName['id']?.isPrimaryKey).toBe(true);
    expect(byName['name']?.nullable).toBe(false);
    expect(byName['email']?.nullable).toBe(true);
    expect(byName['score']?.dataType.toUpperCase()).toContain('REAL');
    await conn.close();
  });

  it('读取索引信息', async () => {
    const conn = await new SqliteDriver().connect(config());
    const indexes = await conn.getMetadata().listIndexes('main', 'users');
    expect(indexes.some((i) => i.name === 'idx_users_name')).toBe(true);
    await conn.close();
  });

  it('读取外键约束', async () => {
    const conn = await new SqliteDriver().connect(config());
    const constraints = await conn.getMetadata().listConstraints('main', 'orders');
    expect(constraints.some((c) => c.type === 'foreign_key')).toBe(true);
    await conn.close();
  });

  it('列出 schema（SQLite 为 main）', async () => {
    const conn = await new SqliteDriver().connect(config());
    const schemas = await conn.getMetadata().listSchemas();
    expect(schemas.map((s) => s.name)).toContain('main');
    await conn.close();
  });
});

describe('查询执行', () => {
  beforeEach(seed);

  it('SELECT 返回列元数据与行数据', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT id, name, score FROM users ORDER BY id');
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'name', 'score']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[1]).toBe('张三');
    expect(result.rowCount).toBe(2);
    await conn.close();
  });

  it('NULL 值保持为 null（不会被转成字符串 "null"）', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT email FROM users ORDER BY id');
    expect(result.rows[1]?.[0]).toBeNull();
    await conn.close();
  });

  it('参数绑定生效且能防注入', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn
      .getQueryExecutor()
      .execute('SELECT name FROM users WHERE name = ?', { params: ["' OR '1'='1"] });
    expect(result.rows).toHaveLength(0);
    await conn.close();
  });

  it('参数绑定可写入并读回中文', async () => {
    const conn = await new SqliteDriver().connect(config());
    await conn.getQueryExecutor().execute('INSERT INTO users (name, score) VALUES (?, ?)', {
      params: ['王五', 60],
    });
    const result = await conn
      .getQueryExecutor()
      .execute('SELECT name, score FROM users WHERE name = ?', { params: ['王五'] });
    expect(result.rows[0]?.[0]).toBe('王五');
    expect(result.rows[0]?.[1]).toBe(60);
    await conn.close();
  });

  it('executeUpdate 返回受影响行数', async () => {
    const conn = await new SqliteDriver().connect(config());
    const changes = await conn.getQueryExecutor().executeUpdate('UPDATE users SET score = score + 1');
    expect(changes).toBe(2);
    await conn.close();
  });

  it('maxRows 截断并标记 truncated', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT * FROM users', { maxRows: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(true);
    await conn.close();
  });

  it('不足 maxRows 时 truncated 为 false', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT * FROM users', { maxRows: 100 });
    expect(result.truncated).toBe(false);
    await conn.close();
  });

  it('记录执行耗时', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT 1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    await conn.close();
  });

  it('语法错误抛 QUERY_FAILED 并带上原始信息', async () => {
    const conn = await new SqliteDriver().connect(config());
    await expect(conn.getQueryExecutor().execute('SELEC oops')).rejects.toThrow();
    await conn.close();
  });

  it('EXPLAIN 返回执行计划', async () => {
    const conn = await new SqliteDriver().connect(config());
    const plan = await conn.getQueryExecutor().explain('SELECT * FROM users WHERE name = ?');
    expect(plan.content.length).toBeGreaterThan(0);
    await conn.close();
  });
});

describe('只读保护', () => {
  beforeEach(seed);

  it('只读连接上的写操作被拒绝', async () => {
    const conn = await new SqliteDriver().connect(config({ readOnly: true }));
    await expect(
      conn.getQueryExecutor().execute("INSERT INTO users (name) VALUES ('x')"),
    ).rejects.toThrow();
    await conn.close();
  });
  it('只读连接仍可查询', async () => {
    const conn = await new SqliteDriver().connect(config({ readOnly: true }));
    const result = await conn.getQueryExecutor().execute('SELECT COUNT(*) FROM users');
    expect(Number(result.rows[0]?.[0])).toBe(2);
    await conn.close();
  });

  it('只读连接上的 DDL 也被拒绝', async () => {
    const conn = await new SqliteDriver().connect(config({ readOnly: true }));
    await expect(
      conn.getQueryExecutor().execute('CREATE TABLE t (a INT)'),
    ).rejects.toThrow();
    await conn.close();
  });
});

describe('DDL 生成', () => {
  it('根据列信息生成建表语句', async () => {
    const conn = await new SqliteDriver().connect(config());
    const ddl = conn.getDdlGenerator().createTable('main', 'demo', [
      {
        schema: 'main',
        table: 'demo',
        name: 'id',
        dataType: 'INTEGER',
        nullable: false,
        defaultValue: null,
        comment: null,
        isPrimaryKey: true,
        ordinal: 1,
      },
      {
        schema: 'main',
        table: 'demo',
        name: 'title',
        dataType: 'TEXT',
        nullable: true,
        defaultValue: null,
        comment: null,
        isPrimaryKey: false,
        ordinal: 2,
      },
    ]);
    expect(ddl).toMatch(/CREATE TABLE/i);
    expect(ddl).toContain('demo');
    expect(ddl).toContain('title');
    await conn.close();
  });

  it('拒绝带非法标识符的表名（注入防护）', async () => {
    const conn = await new SqliteDriver().connect(config());
    expect(() =>
      conn.getDdlGenerator().createTable('main', 'users; DROP TABLE users--', []),
    ).toThrow();
    await conn.close();
  });
});

describe('同名列投影（回归缺陷：按列名组装会覆盖）', () => {
  it('SELECT a.id, b.id 返回两个不同的值', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.execute('CREATE TABLE a (id INTEGER)');
    await exec.execute('CREATE TABLE b (id INTEGER)');
    await exec.execute('INSERT INTO a VALUES (11)');
    await exec.execute('INSERT INTO b VALUES (22)');

    const result = await exec.execute('SELECT a.id, b.id FROM a JOIN b');
    // 列元数据必须保留两份同名 id（按列顺序）
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'id']);
    // 旧实现按列名组装对象，两列都会取到最后一个 id（22），这里必须是 [11, 22]
    expect(result.rows[0]).toEqual([11, 22]);
    await conn.close();
  });

  it('SELECT 1 AS x, 2 AS x 两个表达式的值都在', async () => {
    const conn = await new SqliteDriver().connect(config());
    const result = await conn.getQueryExecutor().execute('SELECT 1 AS x, 2 AS x');
    expect(result.columns.map((c) => c.name)).toEqual(['x', 'x']);
    expect(result.rows[0]).toEqual([1, 2]);
    await conn.close();
  });
});

describe('大整数（回归缺陷：超过 2^53 让整条查询失败）', () => {
  it('9007199254740993 能读出来且值正确', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.execute('CREATE TABLE big (v INTEGER)');
    await exec.execute("INSERT INTO big VALUES (9007199254740993)");

    const result = await exec.execute('SELECT v FROM big');
    // 超出 Number 安全范围：以字符串保真，绝不静默失真
    expect(result.rows[0]?.[0]).toBe('9007199254740993');
    await conn.close();
  });

  it('INTEGER 上下界都能读出且 JSON 序列化不抛错', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.execute('CREATE TABLE big2 (v INTEGER)');
    await exec.execute('INSERT INTO big2 VALUES (9223372036854775807), (-9223372036854775808), (42)');

    const result = await exec.execute('SELECT v FROM big2 ORDER BY rowid');
    expect(result.rows[0]?.[0]).toBe('9223372036854775807');
    expect(result.rows[1]?.[0]).toBe('-9223372036854775808');
    // 安全范围内仍是 Number，保持既有行为
    expect(result.rows[2]?.[0]).toBe(42);
    // 返回给上层前要能 JSON 序列化（BigInt 会直接抛 TypeError）
    expect(() => JSON.stringify(result.rows)).not.toThrow();
    await conn.close();
  });
});

describe('取消标记集合有界（回归缺陷：只增不减）', () => {
  it('反复下发任意 queryId 不会无界增长', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor() as SqliteQueryExecutor;
    for (let i = 0; i < 10_000; i++) {
      exec.cancel(`attacker-supplied-${i}`);
    }
    expect(exec.cancelMarkCount).toBeLessThanOrEqual(256);
    // 超长 id 直接丢弃，连一次登记都不发生
    exec.cancel('x'.repeat(10_000));
    expect(exec.cancelMarkCount).toBeLessThanOrEqual(256);
    // 正常查询不受这些垃圾标记影响
    const result = await exec.execute('SELECT 1 AS v');
    expect(result.rows[0]?.[0]).toBe(1);
    await conn.close();
  });
});

describe('DDL 生成必须真的能被执行（回归缺陷：ON "schema"."table" 语法错误）', () => {
  const column = (name: string, isPrimaryKey = false, ordinal = 1): Parameters<
    ReturnType<Awaited<ReturnType<SqliteDriver['connect']>>['getDdlGenerator']>['createTable']
  >[2][number] => ({
    schema: 'main',
    table: 'ddl_demo',
    name,
    dataType: isPrimaryKey ? 'INTEGER' : 'TEXT',
    nullable: !isPrimaryKey,
    defaultValue: null,
    comment: null,
    isPrimaryKey,
    ordinal,
  });

  /**
   * 这个 describe 里的每个用例都**把生成的语句真的执行一遍**。
   *
   * 之前这里只断言 `ddl` 字符串 `toMatch(/CREATE TABLE/i)` ——
   * 看起来很像测试，其实什么都没验：字符串写得再漂亮，SQLite 也可能不认。
   * 真实缺陷就是这么漏掉的：`createIndex` 生成 `ON "main"."t"`，
   * SQLite 报 `near ".": syntax error`，而"字符串里有没有 CREATE TABLE"
   * 完全查不出来。所以这里的断言标准是"数据库接受它"。
   */
  it('带 schema 的 CREATE INDEX 能真的建出索引', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.executeUpdate(conn.getDdlGenerator().createTable('main', 'ddl_demo', [column('id', true)]));
    const sql = conn.getDdlGenerator().createIndex('main', 'ddl_demo', {
      schema: 'main',
      table: 'ddl_demo',
      name: 'ix_ddl_demo_id',
      columns: ['id'],
      unique: false,
      primary: false,
    });
    // schema 必须限定在索引名上，不能出现在 ON 后面的表名上
    expect(sql).toContain('ON "ddl_demo"');
    expect(sql).not.toContain('ON "main"."ddl_demo"');
    await exec.executeUpdate(sql);
    const found = await exec.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_ddl_demo_id'",
    );
    expect(found.rows).toHaveLength(1);
    await conn.close();
  });

  it('唯一索引也能真的建出来', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.executeUpdate(conn.getDdlGenerator().createTable('main', 'ddl_demo', [column('code')]));
    const sql = conn.getDdlGenerator().createIndex('main', 'ddl_demo', {
      schema: 'main',
      table: 'ddl_demo',
      name: 'ux_ddl_demo_code',
      columns: ['code'],
      unique: true,
      primary: false,
    });
    expect(sql).toMatch(/CREATE UNIQUE INDEX/i);
    await exec.executeUpdate(sql);
    // 唯一性真的生效：插两条相同值必须失败
    await exec.executeUpdate("INSERT INTO ddl_demo (code) VALUES ('a')");
    await expect(exec.executeUpdate("INSERT INTO ddl_demo (code) VALUES ('a')")).rejects.toThrow();
    await conn.close();
  });

  it('createTable(带 indexes) 返回的是多语句文本，一次 execute 会被拒绝', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    const sql = conn.getDdlGenerator().createTable(
      'main',
      'ddl_demo',
      [column('id', true), column('label', false, 2)],
      [
        {
          schema: 'main',
          table: 'ddl_demo',
          name: 'ix_ddl_demo_label',
          columns: ['label'],
          unique: false,
          primary: false,
        },
      ],
    );
    // 这个重载把 CREATE TABLE 与 CREATE INDEX 拼在同一个字符串里，
    // 而 SQLite 一次只能执行一条 —— 多语句防护会拒绝它。
    // 这不是缺陷而是刻意的：调用方必须像 apps/server 的 DDL 路由那样
    // 逐条生成、逐条执行（见 buildCreateTableStatements）。
    expect(splitSqlStatements(sql)).toHaveLength(2);
    await expect(exec.executeUpdate(sql)).rejects.toThrow(/一次只执行一条语句/);
    // 逐条执行则成功，索引真的建出来
    for (const one of splitSqlStatements(sql)) await exec.executeUpdate(one);
    const found = await exec.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_ddl_demo_label'",
    );
    expect(found.rows).toHaveLength(1);
    await conn.close();
  });

  it('带 schema 的 DROP INDEX 能真的删掉索引', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.executeUpdate(conn.getDdlGenerator().createTable('main', 'ddl_demo', [column('id', true)]));
    await exec.executeUpdate(
      conn.getDdlGenerator().createIndex('main', 'ddl_demo', {
        schema: 'main',
        table: 'ddl_demo',
        name: 'ix_ddl_demo_id',
        columns: ['id'],
        unique: false,
        primary: false,
      }),
    );
    await exec.executeUpdate(conn.getDdlGenerator().dropIndex('main', 'ddl_demo', 'ix_ddl_demo_id'));
    const found = await exec.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_ddl_demo_id'",
    );
    expect(found.rows).toHaveLength(0);
    await conn.close();
  });

  it('schema 为空时生成的语句同样能执行（默认库）', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.executeUpdate(conn.getDdlGenerator().createTable('', 'ddl_plain', [column('id', true)]));
    await exec.executeUpdate(
      conn.getDdlGenerator().createIndex('', 'ddl_plain', {
        schema: '',
        table: 'ddl_plain',
        name: 'ix_ddl_plain_id',
        columns: ['id'],
        unique: false,
        primary: false,
      }),
    );
    const found = await exec.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_ddl_plain_id'",
    );
    expect(found.rows).toHaveLength(1);
    await conn.close();
  });
});

describe('多语句脚本必须被拒绝（回归缺陷：静默只执行第一条）', () => {
  /**
   * `node:sqlite` 的 `prepare()` 接受多语句文本，但 `run()` 只执行第一条，
   * 其余**无声丢弃**。也就是说旧实现会把"表 + 索引"这样的脚本执行成
   * "只有表"，然后回报成功 —— 静默的错误结果。
   * 这里要求：要么全做，要么明确报错；绝不能默默少做。
   */
  it('两条语句 → 抛错，且一条都没执行', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await expect(
      exec.execute('CREATE TABLE multi_a (id INTEGER);\nCREATE INDEX ix_multi_a ON multi_a (id);'),
    ).rejects.toThrow(/一次只执行一条语句/);
    // 关键是"什么都没执行"：不能只建了表
    const tables = await exec.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'multi_a'",
    );
    expect(tables.rows).toHaveLength(0);
    await conn.close();
  });

  it('executeUpdate 同样拒绝多语句', async () => {
    const conn = await new SqliteDriver().connect(config());
    await expect(
      conn.getQueryExecutor().executeUpdate('CREATE TABLE multi_b (id INTEGER); DROP TABLE multi_b;'),
    ).rejects.toThrow(/一次只执行一条语句/);
    await conn.close();
  });

  it('单条语句（带结尾分号、带注释）仍然正常执行', async () => {
    const conn = await new SqliteDriver().connect(config());
    const exec = conn.getQueryExecutor();
    await exec.executeUpdate('CREATE TABLE ok_single (id INTEGER);');
    await exec.executeUpdate('-- 注释里有一个分号 ; 不该被当成语句分隔\nINSERT INTO ok_single (id) VALUES (1);');
    const rows = await exec.execute('SELECT id FROM ok_single;');
    expect(rows.rows).toEqual([[1]]);
    // 字符串字面量里的分号也不算分隔符
    const literal = await exec.execute("SELECT 'a;b' AS v, 1 AS n;");
    expect(literal.rows).toEqual([['a;b', 1]]);
    await conn.close();
  });

  it('报错信息里说明了提交了几条语句', async () => {
    const conn = await new SqliteDriver().connect(config());
    await expect(
      conn.getQueryExecutor().execute('SELECT 1; SELECT 2; SELECT 3;'),
    ).rejects.toThrow(/提交了 3 条/);
    await conn.close();
  });
});
