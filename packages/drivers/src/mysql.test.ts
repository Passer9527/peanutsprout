/**
 * 花生苗数据库管理工具 - MySQL 协议族驱动测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 分两部分：
 *  1. 不依赖服务端的部分（方言引号、ALTER 语法、默认端口、EXPLAIN 解析、
 *     类型映射、连接串解析）—— 这部分在任何环境都会真实执行。
 *  2. 依赖真实服务端的部分 —— 仅当设置了 PEANUTSPROUT_TEST_MYSQL_URL 时才跑。
 *     本机环境无法下载到 MySQL/MariaDB 服务端二进制（CDN 吞吐极低、
 *     GitHub Releases 不可达），因此这里**不会**假装验证过真实连接。
 */

import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ConnectionConfig } from '@peanutsprout/core';
import { MysqlDdlGenerator, MysqlDriver, MysqlExplainParser, mysqlPoolOptions, mysqlTypeName, resolveMysqlTarget } from './mysql.js';
import { BaseTypeMapper } from './type-map.js';
import { quoteIdentBacktick, quoteQualified } from './identifiers.js';

const LIVE_URL = process.env['PEANUTSPROUT_TEST_MYSQL_URL'];

/** 与驱动内部一致的 MySQL 方言，用于直接验证 DDL 生成结果 */
const MYSQL_DIALECT_FOR_TEST = {
  quote: quoteIdentBacktick,
  qualified: (schema: string | null | undefined, name: string) => quoteQualified(schema, name, quoteIdentBacktick),
  limitClause: (maxRows: number) => `LIMIT ${maxRows}`,
  renderType: (c: ColumnInfo) => c.dataType,
  explainStatement: (sql: string) => `EXPLAIN ${sql}`,
};

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'mysql-test',
    dbType: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    databaseName: 'demo',
    username: 'root',
    password: 'secret',
    readOnly: false,
    ...overrides,
  };
}

function column(over: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    schema: 'demo',
    table: 't',
    name: 'c',
    dataType: 'int',
    nullable: true,
    defaultValue: null,
    comment: null,
    isPrimaryKey: false,
    ordinal: 1,
    ...over,
  };
}

describe('MySQL 驱动（不依赖服务端）', () => {
  it('注册为已实现，且 MariaDB / TiDB / OceanBase 复用同一实现', async () => {
    const { createDefaultRegistry } = await import('./registry.js');
    const registry = createDefaultRegistry();
    for (const dbType of ['mysql', 'mariadb', 'tidb', 'oceanbase']) {
      expect(registry.get(dbType)?.implemented, dbType).toBe(true);
    }
    expect(registry.get('mysql')?.getInfo().defaultPort).toBe(3306);
    expect(registry.get('tidb')?.getInfo().defaultPort).toBe(4000);
  });

  it('连接串解析：端口不会被默认值覆盖，URL 编码的密码能还原', () => {
    const t = resolveMysqlTarget(
      config({
        connectionUrl: 'mysql://root:p%40ss%3Aword@db.internal:3307/orders',
        host: null,
        port: null,
        databaseName: null,
        username: null,
        password: null,
      }),
    );
    expect(t.host).toBe('db.internal');
    expect(t.port).toBe(3307);
    expect(t.database).toBe('orders');
    expect(t.user).toBe('root');
    expect(t.password).toBe('p@ss:word');
  });

  it('不同分支回退到各自默认端口', () => {
    expect(resolveMysqlTarget(config({ dbType: 'mysql', port: null })).port).toBe(3306);
    expect(resolveMysqlTarget(config({ dbType: 'tidb', port: null })).port).toBe(4000);
    expect(resolveMysqlTarget(config({ dbType: 'oceanbase', port: null })).port).toBe(2881);
    expect(resolveMysqlTarget(config({ dbType: 'mariadb', port: null })).port).toBe(3306);
  });

  it('MySQL 协议族的连接串 scheme 都会被识别（回归缺陷：被静默忽略）', () => {
    for (const [dbType, scheme] of [
      ['mysql', 'mysql'],
      ['mariadb', 'mariadb'],
      ['tidb', 'tidb'],
      ['oceanbase', 'oceanbase'],
    ] as const) {
      const t = resolveMysqlTarget(
        config({
          dbType,
          connectionUrl: `${scheme}://root:pw@db.prod:3306/orders`,
          host: null,
          port: null,
          databaseName: null,
          username: null,
          password: null,
        }),
      );
      // 关键：host 必须是连接串里的远端地址，绝不能静默回落到 localhost
      expect(t.host, scheme).toBe('db.prod');
      expect(t.port, scheme).toBe(3306);
      expect(t.database, scheme).toBe('orders');
      expect(t.user, scheme).toBe('root');
    }
  });

  it('协议头不匹配时显式报错，不静默回落 localhost', () => {
    expect(() =>
      resolveMysqlTarget(config({ connectionUrl: 'postgres://u@db.prod:5432/x', host: null })),
    ).toThrow(/不匹配/);
    expect(() => resolveMysqlTarget(config({ connectionUrl: 'oracle://u@db.prod/x', host: null }))).toThrow(
      /VALIDATION_FAILED|不匹配/,
    );
  });

  it('IPv6 主机名去掉方括号（回归缺陷：ENOTFOUND）', () => {
    const t = resolveMysqlTarget(
      config({
        connectionUrl: 'mysql://root:pw@[::1]:3307/demo',
        host: null,
        port: null,
        databaseName: null,
      }),
    );
    expect(t.host).toBe('::1');
    expect(t.port).toBe(3307);
  });

  it('DATE/DATETIME 以字符串读取，TIMESTAMP 仍保留绝对时刻', () => {
    const opts = mysqlPoolOptions(config());
    expect(opts['dateStrings']).toEqual(['DATE', 'DATETIME']);
    // 不能变成 true：那会把带时区语义的 TIMESTAMP 也降级成墙上时间字符串
    expect(opts['dateStrings']).not.toBe(true);
  });

  it('非法端口给出可操作的报错', () => {
    expect(() => resolveMysqlTarget(config({ port: 70000 }))).toThrow(/端口非法/);
    expect(() => resolveMysqlTarget(config({ port: -1 }))).toThrow(/端口非法/);
  });

  it('DDL 使用反引号，且改列走 MySQL 的 MODIFY COLUMN 语法', () => {
    const ddl = new MysqlDdlGenerator(MYSQL_DIALECT_FOR_TEST);
    const create = ddl.createTable('demo', 'order', [
      column({ name: 'id', dataType: 'int', nullable: false, isPrimaryKey: true }),
      column({ name: 'select', dataType: 'varchar(32)', nullable: false, ordinal: 2 }),
    ]);
    // 关键字列名必须被反引号包住
    expect(create).toContain('CREATE TABLE `demo`.`order`');
    expect(create).toContain('`select`');
    expect(create).toContain('PRIMARY KEY (`id`)');
    expect(create).not.toContain('"');

    // 改类型/可空性：MySQL 一次性给出完整列定义
    const alter = ddl.alterColumn(
      'demo',
      'order',
      column({ name: 'c', dataType: 'int', nullable: true }),
      column({ name: 'c', dataType: 'bigint', nullable: false, defaultValue: '0' }),
    );
    expect(alter).toContain('MODIFY COLUMN `c` bigint NOT NULL DEFAULT 0');
    expect(alter).not.toContain('ALTER COLUMN');

    // DROP INDEX 在 MySQL 上必须带表名
    expect(ddl.dropIndex('demo', 'order', 'idx_x')).toBe('DROP INDEX `idx_x` ON `demo`.`order`;');
  });

  it('EXPLAIN 行被解析成可画图的节点，含访问类型与估算行数', () => {
    const parser = new MysqlExplainParser();
    const plan = parser.parse([
      { id: 1, select_type: 'SIMPLE', table: 'orders', type: 'ALL', rows: 1200, Extra: 'Using where' },
      { id: 1, select_type: 'SIMPLE', table: 'users', type: 'eq_ref', rows: 1, Extra: 'Using index' },
    ]);
    expect(plan.format).toBe('json');
    expect(plan.nodes?.length).toBe(2);
    expect(plan.nodes?.[0]?.label).toBe('ALL on orders');
    expect(plan.nodes?.[0]?.detail).toContain('rows≈1200');
    expect(plan.nodes?.[0]?.detail).toContain('Using where');
    const tree = parser.toTree(plan);
    expect(tree.length).toBe(2);
  });

  it('列类型码映射到可读类型名', () => {
    expect(mysqlTypeName({ type: 3 })).toBe('int');
    expect(mysqlTypeName({ type: 253 })).toBe('var_string');
    expect(mysqlTypeName({ type: 245 })).toBe('json');
    expect(mysqlTypeName({ type: 12 })).toBe('datetime');
    // 未知类型码不应静默变成 undefined
    expect(mysqlTypeName({ type: 999 })).toBe('code:999');
    expect(mysqlTypeName({})).toBe('unknown');
  });

  it('类型映射：MySQL 的 varchar → PostgreSQL 的 varchar', () => {
    const m = new BaseTypeMapper('mysql');
    // 长度信息必须保留，否则迁移会静默截断
    expect(m.mapType('varchar(64)', 'postgresql').type).toBe('VARCHAR(64)');
    expect(m.mapType('tinyint(1)', 'postgresql').type).toBe('SMALLINT');
    // 同库映射不应误报有损
    expect(m.mapType('varchar(64)', 'mysql').lossy).toBe(false);
  });

  it('能力声明如实反映 MySQL 的限制（不支持 CDC）', () => {
    const caps = new MysqlDriver().capabilities;
    expect(caps.transactions).toBe(true);
    expect(caps.ddl).toBe(true);
    expect(caps.explain).toBe(true);
    expect(caps.cdc).toBe(false);
  });

  it('testConnection 在端口不通时返回 ok:false，不抛异常', async () => {
    // 选一个几乎不可能有服务的高位端口
    const result = await new MysqlDriver().testConnection(config({ port: 59999 }));
    expect(result.ok).toBe(false);
    expect(result.serverVersion).toBeNull();
    expect(result.message.length).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * 真实服务端部分。默认跳过，并在跳过时**打印原因**，
 * 避免出现"看起来是绿的、其实一行都没测"的假象。
 */
describe.skipIf(!LIVE_URL)('MySQL 驱动（对接真实服务端）', () => {
  it('能连接、读写中文并读回元数据', async () => {
    const url = new URL(LIVE_URL as string);
    const cfg = config({
      host: url.hostname,
      port: Number(url.port || 3306),
      databaseName: url.pathname.replace(/^\//, '') || null,
      username: decodeURIComponent(url.username) || 'root',
      password: decodeURIComponent(url.password),
      connectionUrl: null,
    });
    const driver = new MysqlDriver();
    const test = await driver.testConnection(cfg);
    expect(test.ok).toBe(true);

    const conn = await driver.connect(cfg);
    try {
      const exec = conn.getQueryExecutor();
      await exec.execute('DROP TABLE IF EXISTS ps_live');
      await exec.execute('CREATE TABLE ps_live (id INT PRIMARY KEY, name VARCHAR(64), memo TEXT)');
      await exec.executeUpdate('INSERT INTO ps_live (id, name, memo) VALUES (?, ?, ?)', [1, '张三', null]);
      await exec.executeUpdate('INSERT INTO ps_live (id, name, memo) VALUES (?, ?, ?)', [2, '李四', "备注'引号"]);
      const res = await exec.execute('SELECT id, name, memo FROM ps_live ORDER BY id');
      expect(res.rowCount).toBe(2);
      expect(res.rows[0]?.[1]).toBe('张三');
      expect(res.rows[0]?.[2]).toBeNull();
      expect(res.rows[1]?.[2]).toBe("备注'引号");

      const columns = await conn.getMetadata().listColumns(cfg.databaseName as string, 'ps_live');
      expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'memo']);
      expect(columns.find((c) => c.name === 'id')?.isPrimaryKey).toBe(true);

      const plan = await exec.explain('SELECT * FROM ps_live WHERE id = 1');
      expect(plan.nodes?.length).toBeGreaterThan(0);

      await exec.execute('DROP TABLE ps_live');
    } finally {
      await conn.close();
    }
  }, 120_000);
});
