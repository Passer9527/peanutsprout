/**
 * 花生苗数据库管理工具 - SQL 语义判定测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这些判定是**只读保护与 AI 写闸门**的唯一依据，
 * 一旦被绕过就等于绕过全部写保护，因此必须覆盖注释/字符串/大小写等绕过手法。
 */

import { describe, expect, it } from 'vitest';
import { isReadStatement, isWriteStatement, splitSqlStatements, stripSqlComments } from './query.js';

describe('isWriteStatement', () => {
  it('识别常见写操作', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'update t set a = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'ALTER TABLE t ADD COLUMN c INT',
      'CREATE TABLE t (a INT)',
      'TRUNCATE TABLE t',
      'REPLACE INTO t VALUES (1)',
      'GRANT SELECT ON t TO u',
      'VACUUM',
    ]) {
      expect(isWriteStatement(sql), sql).toBe(true);
    }
  });

  it('不把只读语句误判为写', () => {
    for (const sql of ['SELECT 1', 'select * from t', 'EXPLAIN SELECT 1', 'SHOW TABLES', 'VALUES (1)']) {
      expect(isWriteStatement(sql), sql).toBe(false);
    }
  });

  it('不被前置注释绕过', () => {
    expect(isWriteStatement('-- 注释\nDELETE FROM t')).toBe(true);
    expect(isWriteStatement('/* 多行\n注释 */ DROP TABLE t')).toBe(true);
    // 用只读注释伪装成写操作是最典型的绕过手段
    expect(isWriteStatement("-- select 1\nUPDATE t SET a = 1")).toBe(true);
  });

  it('不把字符串字面量中的关键字当作语句类型', () => {
    expect(isWriteStatement("SELECT 'delete from users'")).toBe(false);
    expect(isWriteStatement("SELECT '-- drop table x'")).toBe(false);
  });

  it('大小写与前导空白不敏感', () => {
    expect(isWriteStatement('   \n\t InSeRt INTO t VALUES (1)')).toBe(true);
  });
});

describe('isReadStatement', () => {
  it('识别查询语句', () => {
    for (const sql of ['SELECT 1', 'with x as (select 1) select * from x', 'EXPLAIN SELECT 1', 'DESC t']) {
      expect(isReadStatement(sql), sql).toBe(true);
    }
  });

  it('写操作不是读操作', () => {
    expect(isReadStatement('UPDATE t SET a = 1')).toBe(false);
    expect(isReadStatement('CREATE TABLE t (a INT)')).toBe(false);
  });
});

describe('stripSqlComments', () => {
  it('删除行注释与块注释', () => {
    expect(stripSqlComments('SELECT 1 -- 注释\nFROM t')).not.toContain('注释');
    expect(stripSqlComments('SELECT /* 注释 */ 1')).not.toContain('注释');
  });

  it('保留字符串字面量原样', () => {
    expect(stripSqlComments("SELECT '-- 不是注释'")).toContain('-- 不是注释');
    expect(stripSqlComments("SELECT '/* 不是注释 */'")).toContain('/* 不是注释 */');
  });

  it('正确处理转义引号', () => {
    // '' 是 SQL 里的转义单引号，不能提前结束字符串
    const result = stripSqlComments("SELECT 'it''s -- ok' AS x -- 真注释");
    expect(result).toContain("it''s -- ok");
    expect(result).not.toContain('真注释');
  });
});

describe('splitSqlStatements', () => {
  it('按分号拆分多语句', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('忽略字符串中的分号', () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      'SELECT 1',
    ]);
  });

  it('忽略注释中的分号', () => {
    expect(splitSqlStatements('SELECT 1; -- 分号; 不是分隔符\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('忽略空语句与结尾分号', () => {
    expect(splitSqlStatements(';;SELECT 1;;')).toEqual(['SELECT 1']);
    expect(splitSqlStatements('SELECT 1;')).toEqual(['SELECT 1']);
  });
});

/**
 * 回归测试：以下每一条都是**真实存在过**的绕过手法。
 *
 * 旧实现只看语句的第一个关键字（正则），因此 `WITH ... DELETE`、
 * `SELECT 1; DROP TABLE t` 都被判为只读 —— 只读账号据此可以删库。
 * 这些用例的作用是防止判定逻辑再退化回"前缀匹配"。
 */
describe('isWriteStatement · 写闸门绕过手法（回归）', () => {
  const BYPASSES = [
    // CTE 前缀 DML：动词不在句首
    'WITH c AS (SELECT 1 AS a) DELETE FROM t',
    'WITH c AS (SELECT 9 AS a) INSERT INTO t(v) SELECT a FROM c',
    'WITH c AS (SELECT 9 AS a) UPDATE t SET v = a',
    'WITH a AS (SELECT 1), b AS (SELECT 2) DELETE FROM t WHERE id IN (SELECT * FROM a)',
    'WITH RECURSIVE r AS (SELECT 1) DELETE FROM t',
    'WITH "my cte" AS (SELECT 1) DELETE FROM t',
    // 多语句：只检查第一条会漏掉后面的写
    'SELECT 1 AS one; DROP TABLE t; -- limit',
    "SELECT 'limit' AS x; DROP TABLE t;",
    'SELECT 1; DELETE FROM t',
    // EXPLAIN ANALYZE 会真的执行被包裹的语句
    'EXPLAIN ANALYZE DELETE FROM t',
    // MySQL 的 # 行注释
    '# 注释\nDELETE FROM t',
  ];

  it.each(BYPASSES)('必须判为写操作: %s', (sql) => {
    expect(isWriteStatement(sql)).toBe(true);
    expect(isReadStatement(sql)).toBe(false);
  });

  const LEGITIMATE_READS = [
    'SELECT 1',
    'select * from t',
    "SELECT 'delete from users'",
    "SELECT '-- drop table x'",
    'EXPLAIN SELECT 1',
    'SHOW TABLES',
    'VALUES (1)',
    'DESC t',
    'TABLE t',
    'with x as (select 1) select * from x',
    'WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a JOIN b ON 1=1',
    'WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r',
    // 字符串里出现 limit 不能影响判定
    "SELECT * FROM t WHERE msg = 'no limit'",
    // MySQL 行尾 # 注释不影响只读判定
    'SELECT 1 # 说明',
  ];

  it.each(LEGITIMATE_READS)('不能误判为写操作: %s', (sql) => {
    expect(isWriteStatement(sql)).toBe(false);
    expect(isReadStatement(sql)).toBe(true);
  });

  it('无法识别的动词按写处理（fail-closed）', () => {
    // 宁可让用户多点一次确认，也不能让未知语法成为绕过通道
    expect(isWriteStatement('FOOBAR TABLE t')).toBe(true);
  });
});

/**
 * 第二轮对抗性安全验证真实复现的写闸门绕过手法（每条都在修复前实测可绕过）。
 *
 * 背景：写闸门只有 isWriteStatement 这一道判据，它一旦漏判，
 * 「query.write 权限 / 连接只读 / 资源授权 / 二次确认」四道闸门会**同时**失效。
 * 因此下面每一条都必须判为 write。
 */
describe('写闸门 · 对抗性验证复现的绕过手法（回归）', () => {
  it('PostgreSQL 数据修改 CTE：体里的 DML 会被真正执行，不能只看主语句动词', () => {
    // 修复前：findMainVerb 跳过 CTE 体，topLevelWords 只看深度 0，于是判 read；
    // 实测只读账号执行它删掉了 3 行数据。
    expect(isWriteStatement('WITH w AS (DELETE FROM t RETURNING *) SELECT count(*) AS n FROM w')).toBe(true);
    expect(isWriteStatement('WITH w AS (INSERT INTO t(v) VALUES (42) RETURNING *) SELECT v FROM w')).toBe(true);
    expect(isWriteStatement('WITH w AS (UPDATE t SET v = 1 RETURNING *) SELECT * FROM w')).toBe(true);
    expect(isWriteStatement('WITH w AS (MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE) SELECT 1')).toBe(true);
    // 递归 CTE 与嵌套 CTE 同样要看清
    expect(isWriteStatement('WITH RECURSIVE w AS (DELETE FROM t RETURNING *) SELECT 1')).toBe(true);
    expect(isWriteStatement('WITH a AS (SELECT 1), w AS (DELETE FROM t RETURNING *) SELECT 1')).toBe(true);
    // PostgreSQL 12+ 的 AS MATERIALIZED
    expect(isWriteStatement('WITH w AS MATERIALIZED (DELETE FROM t RETURNING *) SELECT 1')).toBe(true);
    expect(isWriteStatement('WITH w AS NOT MATERIALIZED (DELETE FROM t RETURNING *) SELECT 1')).toBe(true);
  });

  it('纯只读的 CTE 不能被误判为写（否则正常查询会被拦）', () => {
    expect(isWriteStatement('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false);
    expect(isWriteStatement('WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM x WHERE n < 5) SELECT * FROM x')).toBe(false);
    expect(isWriteStatement('WITH x AS MATERIALIZED (SELECT id FROM t) SELECT count(*) FROM x')).toBe(false);
  });

  it('PostgreSQL 的 SELECT ... INTO <新表> 会建表，属于写操作', () => {
    // 修复前 'into' 不在写动词里，实测只读账号用它建出了表。
    expect(isWriteStatement('SELECT * INTO newtable FROM t')).toBe(true);
    expect(isWriteStatement('SELECT * INTO TEMP tt FROM t')).toBe(true);
    expect(isWriteStatement('SELECT id INTO UNLOGGED u FROM t')).toBe(true);
    // OUTFILE / DUMPFILE 本来就要拦（写文件同样是写副作用）
    expect(isWriteStatement("SELECT * INTO OUTFILE '/tmp/x' FROM t")).toBe(true);
    expect(isWriteStatement("SELECT * INTO DUMPFILE '/tmp/x' FROM t")).toBe(true);
  });

  it('MySQL / MariaDB 的可执行版本注释里是会被真正执行的 SQL', () => {
    // 修复前 /* ... */ 被整段当注释丢掉，单独一条可执行注释甚至被拆成 0 条语句。
    expect(isWriteStatement('/*!50000 DROP TABLE t */')).toBe(true);
    expect(isWriteStatement('SELECT 1; /*!50000 DROP TABLE t */')).toBe(true);
    expect(isWriteStatement('/*M!100100 DELETE FROM t */')).toBe(true);
    expect(isWriteStatement('/*!40000 ALTER TABLE t ADD COLUMN c INT */')).toBe(true);
  });

  it('但 mysqldump 风格的只读版本注释不能被误拦', () => {
    // mysqldump 就是这么写的，属于正常只读查询，误拦会直接破坏真实用法。
    expect(isWriteStatement('SELECT /*!40001 SQL_NO_CACHE */ * FROM t')).toBe(false);
    expect(isWriteStatement('SELECT /*!40001 SQL_NO_CACHE */ id FROM t WHERE id > 1')).toBe(false);
  });

  it('MySQL 的 `--` 只有后跟空白才算注释', () => {
    // 修复前把 `--1` 当行注释吃掉，`SELECT 1--1; DROP TABLE t` 整句被判 read。
    // MySQL 里它是 SELECT 1-(-1) 后面跟一条**真的 DROP**。
    expect(isWriteStatement('SELECT 1--1; DROP TABLE t')).toBe(true);
    expect(isWriteStatement('SELECT 1 --1; DROP TABLE t')).toBe(true);
    // 正常带空白的注释仍然是注释
    expect(isWriteStatement('SELECT 1 -- 这是注释')).toBe(false);
    expect(isWriteStatement('SELECT 1\n-- 这是注释\nFROM t')).toBe(false);
  });

  it('注释里出现写动词时保守判为写（记录这个刻意取舍）', () => {
    // `--delete`（无空格）在 PostgreSQL 里是注释，在 MySQL 里不是。
    // 判定器取"按 MySQL 语义"的保守方向：宁可让用户多点一次确认，
    // 也不能让 MySQL 下的一条真 DROP 溜过去。
    expect(isWriteStatement('SELECT 1 --delete old rows')).toBe(true);
  });

  it('无法解析出动词时 fail-closed，绝不默认只读', () => {
    // 全角关键字：读不到 ASCII 动词时不能当成只读
    expect(isWriteStatement('ＤＥＬＥＴＥ FROM t')).toBe(true);
    expect(isWriteStatement('ｕｐｄａｔｅ t set v = 1')).toBe(true);
    // 空白之外的畸形输入
    expect(isWriteStatement('!!!')).toBe(true);
    expect(isWriteStatement('(((')).toBe(true);
  });

  it('只读语句不被误判（反向回归）', () => {
    for (const sql of [
      'SELECT 1',
      'select * from t',
      'EXPLAIN SELECT * FROM t',
      'EXPLAIN ANALYZE SELECT * FROM t',
      'SHOW TABLES',
      'SHOW VARIABLES LIKE "x"',
      'DESC t',
      'DESCRIBE t',
      'VALUES (1), (2)',
      'TABLE t',
      'SELECT count(*) FROM t WHERE note = \'delete from users\'',
      'SELECT * FROM t WHERE id IN (SELECT id FROM u)',
      'SELECT a FROM t UNION ALL SELECT b FROM u',
    ]) {
      expect(isReadStatement(sql), sql).toBe(true);
    }
  });

  it('SHOW CREATE TABLE 会被保守判为写（已知取舍，不是回归）', () => {
    // 顶层出现 create，与写语句无法廉价区分；本项目取"宁可误拦"的方向。
    // 这里把行为固定下来，避免将来有人无声改掉它。
    expect(isWriteStatement('SHOW CREATE TABLE t')).toBe(true);
  });

  it('拆分多语句时保留可执行注释的原文，保证导入执行不缺字符', () => {
    const parts = splitSqlStatements("/*!50000 DROP TABLE t */");
    expect(parts).toEqual(['/*!50000 DROP TABLE t */']);
  });
});
