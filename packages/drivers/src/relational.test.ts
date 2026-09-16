/**
 * 花生苗数据库管理工具 - 关系型执行器公共逻辑测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 用假的 `run` 回调直接观察执行器**实际发出去的 SQL** 与结果处理：
 * maxRows 限行、truncated 判定、顶层 LIMIT 识别、超时处置、取消集合边界。
 * 这些逻辑与具体数据库无关，因此不需要真实服务端。
 */

import { describe, expect, it, vi } from 'vitest';
import { BoundedCancelSet } from './cancel-set.js';
import {
  RelationalQueryExecutor,
  hasTopLevelLimit,
  withQueryTimeout,
  type RawQueryResult,
  type RelationalDialect,
} from './relational.js';

const DIALECT: RelationalDialect = {
  quote: (name) => `"${name}"`,
  qualified: (_schema, name) => name,
  limitClause: (maxRows) => `LIMIT ${maxRows}`,
  renderType: (column) => column.dataType,
  explainStatement: (sql) => `EXPLAIN ${sql}`,
};

function result(rows: unknown[][], affectedRows = 0): RawQueryResult {
  return {
    columns: [{ name: 'v', dataType: 'integer' }],
    rows: rows as RawQueryResult['rows'],
    affectedRows,
  };
}

/** 记录执行器实际发出的 SQL，并返回可配置的行集。 */
function makeExecutor(rowsFor: (sql: string) => RawQueryResult = () => result([[1]])): {
  exec: RelationalQueryExecutor;
  calls: string[];
} {
  const calls: string[] = [];
  const exec = new RelationalQueryExecutor(DIALECT, async (sql) => {
    calls.push(sql);
    return rowsFor(sql);
  });
  return { exec, calls };
}

describe('hasTopLevelLimit（不能靠文本搜索判断）', () => {
  it('字符串字面量里的 limit 不算', () => {
    expect(hasTopLevelLimit("SELECT * FROM logs WHERE msg = 'no limit'")).toBe(false);
  });

  it('注释里的 limit 不算', () => {
    expect(hasTopLevelLimit('SELECT 1 -- 这里写 limit 只是注释')).toBe(false);
    expect(hasTopLevelLimit('SELECT 1 /* limit 5 */')).toBe(false);
  });

  it('真正的顶层 LIMIT / FETCH FIRST 才算', () => {
    expect(hasTopLevelLimit('SELECT * FROM t LIMIT 5')).toBe(true);
    expect(hasTopLevelLimit('SELECT * FROM t ORDER BY id LIMIT 10 OFFSET 5')).toBe(true);
    expect(hasTopLevelLimit('SELECT * FROM t FETCH FIRST 10 ROWS ONLY')).toBe(true);
  });

  it('子查询 / CTE 里的 LIMIT 不是顶层限制，外层仍需补 LIMIT', () => {
    expect(hasTopLevelLimit('SELECT * FROM (SELECT 1 LIMIT 1) t')).toBe(false);
    expect(hasTopLevelLimit('WITH c AS (SELECT 1 LIMIT 1) SELECT * FROM c')).toBe(false);
  });
});

describe('maxRows 限行（回归缺陷：文本搜索可被绕过）', () => {
  it("SQL 里含 'no limit' 字符串时仍会追加 LIMIT", async () => {
    const { exec, calls } = makeExecutor();
    await exec.execute("SELECT * FROM logs WHERE msg = 'no limit'", { maxRows: 3 });
    expect(calls[0]).toContain('LIMIT 4'); // 多取一行以便判断 truncated
  });

  it('行尾 -- 注释不会吞掉追加的 LIMIT', async () => {
    const { exec, calls } = makeExecutor();
    await exec.execute('SELECT 1 -- 没有 limit 字样', { maxRows: 3 });
    // 注释被去掉后再拼接，LIMIT 一定生效
    expect(calls[0]).toMatch(/LIMIT 4\s*$/);
    expect(calls[0]).not.toContain('--');
  });

  it('超过 maxRows 时截断并准确标记 truncated', async () => {
    const { exec } = makeExecutor(() => result([[1], [2], [3], [4]]));
    const res = await exec.execute('SELECT v FROM t', { maxRows: 3 });
    expect(res.rows).toHaveLength(3);
    expect(res.truncated).toBe(true);
    expect(res.rowCount).toBe(3);
  });

  it('结果恰好等于 maxRows 时 truncated 为 false（不再误报）', async () => {
    const { exec } = makeExecutor(() => result([[1], [2], [3]]));
    const res = await exec.execute('SELECT v FROM t', { maxRows: 3 });
    expect(res.rows).toHaveLength(3);
    expect(res.truncated).toBe(false);
  });

  it('已有顶层 LIMIT 时不再追加第二个 LIMIT', async () => {
    const { exec, calls } = makeExecutor(() => result([[1]]));
    await exec.execute('SELECT * FROM t LIMIT 5', { maxRows: 3 });
    expect(calls[0]).toBe('SELECT * FROM t LIMIT 5');
  });

  it('只读语句才追加 LIMIT；写语句加 LIMIT 会改变语义', async () => {
    const { exec, calls } = makeExecutor(() => result([], 7));
    const res = await exec.execute('UPDATE t SET v = 1', { maxRows: 3 });
    expect(calls[0]).not.toContain('LIMIT');
    expect(res.affectedRows).toBe(7);
    expect(res.truncated).toBe(false);
  });
});

describe('withQueryTimeout（超时后必须丢弃连接）', () => {
  it('未超时时原样返回结果', async () => {
    const onTimeout = vi.fn();
    await expect(withQueryTimeout(Promise.resolve('ok'), 50, onTimeout)).resolves.toBe('ok');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('超时抛 QUERY_TIMEOUT 并触发连接丢弃回调', async () => {
    const onTimeout = vi.fn();
    const never = new Promise<string>(() => undefined);
    await expect(withQueryTimeout(never, 20, onTimeout)).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('timeoutMs 为 0 时不做超时处理（避免误杀长查询）', async () => {
    const onTimeout = vi.fn();
    await expect(withQueryTimeout(Promise.resolve(1), 0, onTimeout)).resolves.toBe(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('BoundedCancelSet（取消标记不得无界增长）', () => {
  it('容量固定，超出后淘汰最久未使用的标记', () => {
    const set = new BoundedCancelSet(4);
    for (let i = 0; i < 100; i++) set.add(`q-${i}`);
    expect(set.size).toBe(4);
    expect(set.has('q-99')).toBe(true);
    expect(set.has('q-0')).toBe(false);
  });

  it('超长或空 id 被丢弃', () => {
    const set = new BoundedCancelSet(8, 16);
    expect(set.add('x'.repeat(17))).toBe(false);
    expect(set.add('')).toBe(false);
    expect(set.size).toBe(0);
    expect(set.add('ok')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('delete 能清理标记', () => {
    const set = new BoundedCancelSet(8);
    set.add('a');
    set.delete('a');
    expect(set.has('a')).toBe(false);
  });
});
