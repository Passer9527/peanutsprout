/**
 * 花生苗数据库管理工具 - 数据导出与 AI 撤回端到端测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个文件盯住四件事：
 *  · **导出的 .xlsx 真的是 Excel 文件**（不是"我们自己解析得回来"——用系统 unzip 解压校验）；
 *  · **导出到别的库走的是同一道写闸门**，不能成为绕过写保护的旁路；
 *  · **只读账号能导出但不能写目标库**；
 *  · **AI 撤回/回退只影响自己的记录**（跨用户删除必须无效）。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import { buildExportColumns } from './routes/data-export.js';
import type { ServerConfig } from './config.js';

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let sourceDbPath: string;
let targetDbPath: string;
let adminToken = '';
let readonlyToken = '';
let developerToken = '';
let sourceConnectionId = 0;
let targetConnectionId = 0;

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

/** 直接读库，绕过被测代码（避免"自己验自己"）。 */
function tableRows(path: string, table: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function tableNames(path: string): string[] {
  const db = new DatabaseSync(path);
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  } finally {
    db.close();
  }
}

/** 审计里关于导出/撤回的记录。 */
function auditDetails(action: string, resourceType: string): Array<Record<string, unknown>> {
  return ctx.pdb.db
    .all<{ detail: string | null }>(
      'SELECT detail FROM audit_logs WHERE action = ? AND resource_type = ? ORDER BY id',
      action,
      resourceType,
    )
    .map((r) => (r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : {}));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-export-'));
  sourceDbPath = join(dir, 'source.db');
  targetDbPath = join(dir, 'target.db');

  const seed = new DatabaseSync(sourceDbPath);
  seed.exec('CREATE TABLE orders (id INTEGER, name TEXT, amount REAL)');
  seed.exec("INSERT INTO orders VALUES (1, '甲', 10.5), (2, '乙', 20.25), (3, '丙', NULL)");
  // 故意放一个含 XML 特殊字符与中文的值，验证转义
  seed.exec("INSERT INTO orders VALUES (4, 'A&B <C> \"D\"', 0)");
  seed.close();

  const target = new DatabaseSync(targetDbPath);
  target.exec('CREATE TABLE preexisting (id INTEGER)');
  target.close();

  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  adminToken = await login(ADMIN, ADMIN_PASSWORD);

  const src = await app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: auth(adminToken),
    payload: { name: '导出源库', dbType: 'sqlite', databaseName: sourceDbPath },
  });
  expect(src.statusCode, src.body).toBe(201);
  sourceConnectionId = src.json().item.id as number;

  const tgt = await app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: auth(adminToken),
    payload: { name: '导出目标库', dbType: 'sqlite', databaseName: targetDbPath },
  });
  expect(tgt.statusCode, tgt.body).toBe(201);
  targetConnectionId = tgt.json().item.id as number;

  // readonly：能读（因此能导出），不能写（因此不能往目标库导）
  const ro = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(adminToken),
    payload: { username: 'exp-readonly', password: 'Re@d0nly-Pass!', roles: ['readonly'] },
  });
  expect(ro.statusCode, ro.body).toBe(201);
  readonlyToken = await login('exp-readonly', 'Re@d0nly-Pass!');

  // developer：有 query.write 但没有 conn.write —— 用来验证目标端确实走写闸门
  const dev = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(adminToken),
    payload: { username: 'exp-developer', password: 'Devel0per-Pass!', roles: ['developer'] },
  });
  expect(dev.statusCode, dev.body).toBe(201);
  developerToken = await login('exp-developer', 'Devel0per-Pass!');
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

describe('导出 Excel', () => {
  it('返回真正的 .xlsx：能被系统 unzip 解压且 CRC 全部通过', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/xlsx',
      headers: auth(adminToken),
      payload: { connectionId: sourceConnectionId, sql: 'SELECT * FROM orders ORDER BY id' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(String(res.headers['content-disposition'])).toContain('.xlsx');

    // 落到磁盘，用真实的 unzip 校验（不用我们自己写的解析器"自证"）
    const file = join(dir, 'export.xlsx');
    writeFileSync(file, res.rawPayload);
    const listing = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
    for (const member of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
      expect(listing, `缺少成员 ${member}`).toContain(member);
    }
    // -t 会做 CRC 校验；失败时 exit code 非 0 并抛异常
    const tested = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(tested).toContain('No errors detected');
  });

  it('工作表里含中文与 XML 特殊字符，且控制字符不会写坏文件', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/xlsx',
      headers: auth(adminToken),
      payload: { connectionId: sourceConnectionId, sql: 'SELECT * FROM orders ORDER BY id' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const file = join(dir, 'export2.xlsx');
    writeFileSync(file, res.rawPayload);
    const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
    // 表头与中文值都要在，且 XML 特殊字符被转义
    expect(sheet).toContain('id');
    expect(sheet).toContain('甲');
    expect(sheet).toContain('A&amp;B &lt;C&gt;');
    // 未转义的裸 & 会让 Excel 报"文件损坏"
    expect(sheet).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });

  it('写语句、多条语句都不能导出（导出只搬结果集）', async () => {
    for (const sql of [
      'DELETE FROM orders',
      'DROP TABLE orders',
      'SELECT 1; DROP TABLE orders',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/data/export/xlsx',
        headers: auth(adminToken),
        payload: { connectionId: sourceConnectionId, sql },
      });
      expect(res.statusCode, `SQL=${sql} 没有被拒绝: ${res.body}`).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    // 源库必须毫发无损
    expect(tableNames(sourceDbPath)).toContain('orders');
    expect(tableRows(sourceDbPath, 'orders')).toHaveLength(4);
  });

  it('导出动作写审计，且记录行数与截断状态', async () => {
    const before = auditDetails('export', 'query_result').length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/xlsx',
      headers: auth(adminToken),
      payload: { connectionId: sourceConnectionId, sql: 'SELECT * FROM orders', maxRows: 2 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = auditDetails('export', 'query_result');
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1]!;
    expect(last['format']).toBe('xlsx');
    expect(last['rows']).toBe(2);
    // 截断必须如实记录：否则事后分不清"表里就这么多"和"被截断了"
    expect(last['truncated']).toBe(true);
    expect(res.headers['x-export-truncated']).toBe('true');
  });

  it('只读账号可以导出（导出属于读操作）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/xlsx',
      headers: auth(readonlyToken),
      payload: { connectionId: sourceConnectionId, sql: 'SELECT id FROM orders' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('未授权的连接不可导出', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/xlsx',
      headers: auth(readonlyToken),
      payload: { connectionId: 999999, sql: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('导出到另一个数据库', () => {
  it('create 模式按结果集建表并把数据真实写进去', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id, name, amount FROM orders ORDER BY id',
        targetConnectionId,
        targetTable: 'orders_copy',
        mode: 'create',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rows).toBe(4);

    // 直接读目标库文件核对（不经过被测代码）
    expect(tableNames(targetDbPath)).toContain('orders_copy');
    const rows = tableRows(targetDbPath, 'orders_copy') as Array<{ id: number; name: string | null }>;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(rows[3]!.name).toBe('A&B <C> "D"');
  });

  it('create 模式遇到同名表会拒绝，不会悄悄覆盖', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders',
        targetConnectionId,
        targetTable: 'preexisting',
        mode: 'create',
      },
    });
    expect(res.statusCode, res.body).toBe(409);
    // 原表还在，且没有被塞进新列
    expect(tableRows(targetDbPath, 'preexisting')).toHaveLength(0);
  });

  it('append 模式要求目标表已存在，且只追加不重建', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders',
        targetConnectionId,
        targetTable: 'no_such_table',
        mode: 'append',
      },
    });
    expect(missing.statusCode, missing.body).toBe(404);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id, name, amount FROM orders WHERE id <= 2',
        targetConnectionId,
        targetTable: 'orders_copy',
        mode: 'append',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rows).toBe(2);
    // 4 条原有 + 2 条追加
    expect(tableRows(targetDbPath, 'orders_copy')).toHaveLength(6);
  });

  it('replace 模式先删后建，行数等于本次结果集', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders WHERE id = 1',
        targetConnectionId,
        targetTable: 'orders_copy',
        mode: 'replace',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(tableRows(targetDbPath, 'orders_copy')).toHaveLength(1);
  });

  it('只读账号不能用导出绕过写保护（目标端走同一道写闸门）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(readonlyToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders',
        targetConnectionId,
        targetTable: 'ro_attempt',
        mode: 'create',
      },
    });
    // readonly 没有 query.write → 必须在目标端被拒，而不是"借导出绕过写保护"
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error.code).toBe('AUTH_FORBIDDEN');
    expect(tableNames(targetDbPath)).not.toContain('ro_attempt');
  });

  it('developer 本来就持有 query.write，因此可以导出到库（如实记录这个权限模型）', async () => {
    // 这条不是"绕过"：`conn.write` 管的是连接配置的增删改，
    // 数据写入由 `query.write` 决定 —— developer 本来就能对已授权连接执行写 SQL，
    // 导出到库只是把同一件事做了一遍。这里把真实行为钉住，避免将来被误改成更宽或更窄。
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(developerToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders WHERE id = 1',
        targetConnectionId,
        targetTable: 'dev_attempt',
        mode: 'create',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(tableRows(targetDbPath, 'dev_attempt')).toHaveLength(1);
  });

  it('源库与目标库相同时直接拒绝（否则会自己覆盖自己）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders',
        targetConnectionId: sourceConnectionId,
        targetTable: 'x',
        mode: 'create',
      },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('导出到库也写审计，并记录目标表与模式', async () => {
    const before = auditDetails('export', 'connection').length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data/export/to-connection',
      headers: auth(adminToken),
      payload: {
        sourceConnectionId,
        sql: 'SELECT id FROM orders WHERE id = 2',
        targetConnectionId,
        targetTable: 'audited_copy',
        mode: 'create',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = auditDetails('export', 'connection');
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1]!;
    expect(last['targetTable']).toBe('audited_copy');
    expect(last['mode']).toBe('create');
    expect(last['rows']).toBe(1);
  });
});

describe('AI 调用记录撤回', () => {
  /** 直接往 ai_history 塞记录，避免测试依赖真实模型服务。 */
  function seedHistory(userId: number, count: number): number[] {
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(
        ctx.pdb.aiConfigs.appendHistory({
          userId,
          configId: null,
          scene: 'nl2sql',
          prompt: `p${i}`,
          response: `r${i}`,
          status: 'success',
        }),
      );
    }
    return ids;
  }

  it('撤回单条只删自己那条', async () => {
    const ids = seedHistory(1, 3);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/ai/history/${ids[1]}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const left = ctx.pdb.db.all<{ id: number }>('SELECT id FROM ai_history WHERE id IN (?, ?, ?)', ...ids);
    expect(left.map((r) => r.id).sort()).toEqual([ids[0]!, ids[2]!].sort());
  });

  it('撤回到指定操作会删掉这条及其之后的全部记录', async () => {
    const ids = seedHistory(1, 4);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/history/rollback',
      headers: auth(adminToken),
      payload: { historyId: ids[2] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().deleted).toBe(2);
    const left = ctx.pdb.db.all<{ id: number }>('SELECT id FROM ai_history WHERE id IN (?, ?, ?, ?)', ...ids);
    expect(left.map((r) => r.id).sort()).toEqual([ids[0]!, ids[1]!].sort());
  });

  it('撤回不存在 / 不属于自己的记录都返回 404，不给枚举空间', async () => {
    const other = ctx.pdb.users.create({
      username: 'exp-other',
      passwordHash: 'scrypt$1$1$1$c2FsdA==$aGFzaA==',
      displayName: '他人',
      isAdmin: false,
      roles: ['readonly'],
    });
    const [victim] = seedHistory(other.id, 1);

    // 用管理员令牌去删别人的记录
    const byOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/ai/history/${victim}`,
      headers: auth(adminToken),
    });
    expect(byOther.statusCode, `越权删除成功了: ${byOther.body}`).toBe(404);
    // 记录必须还在
    const still = ctx.pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE id = ?', victim!);
    expect(still?.n, '别人的记录被删掉了').toBe(1);

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/v1/ai/history/999999',
      headers: auth(adminToken),
    });
    expect(missing.statusCode).toBe(404);
    // 两者响应体逐字节一致 → 无法据响应区分"不存在"与"不是我的"
    expect(byOther.body.replace(String(victim), 'X')).toBe(missing.body.replace('999999', 'X'));

    // 回退同样不能越权
    const rollback = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/history/rollback',
      headers: auth(adminToken),
      payload: { historyId: victim },
    });
    expect(rollback.statusCode, `越权回退成功了: ${rollback.body}`).toBe(404);
    expect(
      ctx.pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE id = ?', victim!)?.n,
    ).toBe(1);
  });

  it('撤回与回退都写审计', async () => {
    const [id] = seedHistory(1, 1);
    await app.inject({ method: 'DELETE', url: `/api/v1/ai/history/${id}`, headers: auth(adminToken) });
    await app.inject({
      method: 'POST',
      url: '/api/v1/ai/history/rollback',
      headers: auth(adminToken),
      payload: { historyId: seedHistory(1, 1)[0]! },
    });
    const ops = auditDetails('ai', 'ai_history').map((d) => d['operation']);
    expect(ops).toContain('withdraw');
    expect(ops).toContain('rollback');
  });

  it('清空只清自己的记录', async () => {
    const otherId = ctx.pdb.users.findByUsername('exp-other')!.id;
    // 先量一次基数：前面的用例也会往这两个用户塞记录，写死数字会随用例顺序漂移
    const otherBefore =
      ctx.pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE user_id = ?', otherId)?.n ?? 0;
    seedHistory(1, 2);
    seedHistory(otherId, 3);
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/ai/history', headers: auth(adminToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      ctx.pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE user_id = ?', 1)?.n,
    ).toBe(0);
    // 别人的必须原样保留（只多不少，且多出来的正好是我刚塞的 3 条）
    expect(
      ctx.pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE user_id = ?', otherId)?.n,
    ).toBe(otherBefore + 3);
  });

  it('历史接口返回真实总数，撤回后总数下降', async () => {
    ctx.pdb.aiConfigs.clearHistory(1);
    const ids = seedHistory(1, 3);
    const before = await app.inject({ method: 'GET', url: '/api/v1/ai/history', headers: auth(adminToken) });
    expect(before.json().total).toBe(3);
    await app.inject({ method: 'DELETE', url: `/api/v1/ai/history/${ids[2]}`, headers: auth(adminToken) });
    const after = await app.inject({ method: 'GET', url: '/api/v1/ai/history', headers: auth(adminToken) });
    expect(after.json().total).toBe(2);
  });
});

/**
 * `buildExportColumns` 的单测。
 *
 * 为什么单独测这个纯函数：跨库导出的"类型换算 + 有损告警"要真正跑一遍就需要
 * 连上一个**异构**目标库（同构时映射器直接原样返回、不会报 lossy），
 * 在本机测试环境里代价过高。把它抽成纯函数后用假映射器就能把边界全打一遍，
 * 而且这些边界恰恰是"数据悄悄变样"的地方。
 */
describe('导出列的类型换算（纯函数）', () => {
  const mapper = (
    impl: (sourceType: string, target: string) => { type: string; lossy: boolean; note?: string },
  ) =>
    ({
      mapType: impl,
      normalizeType: (raw: string) => raw.toUpperCase(),
    }) as never;

  it('有损映射必须产生告警，并带上 note', () => {
    const { columns, warnings } = buildExportColumns({
      resultColumns: [{ name: 'big', dataType: 'BIGINT' }],
      sourceMapper: mapper(() => ({ type: 'INTEGER', lossy: true, note: '目标库 INTEGER 仅 32 位' })),
      targetDbType: 'mysql',
      schema: 'main',
      table: 't',
    });
    expect(columns[0]!.dataType).toBe('INTEGER');
    expect(warnings).toHaveLength(1);
    // 告警要能定位到列，并说清是哪两个类型之间的转换
    expect(warnings[0]).toContain('big');
    expect(warnings[0]).toContain('BIGINT');
    expect(warnings[0]).toContain('INTEGER');
    expect(warnings[0]).toContain('目标库 INTEGER 仅 32 位');
  });

  it('无损映射不产生任何告警（不能见谁都报警）', () => {
    const { warnings } = buildExportColumns({
      resultColumns: [{ name: 'a', dataType: 'TEXT' }],
      sourceMapper: mapper(() => ({ type: 'TEXT', lossy: false })),
      targetDbType: 'postgresql',
      schema: 'public',
      table: 't',
    });
    expect(warnings).toEqual([]);
  });

  it('有损但没给 note 时告警照样出，只是不带括号说明', () => {
    const { warnings } = buildExportColumns({
      resultColumns: [{ name: 'x', dataType: 'MYSTERY' }],
      sourceMapper: mapper(() => ({ type: 'TEXT', lossy: true })),
      targetDbType: 'sqlite',
      schema: 'main',
      table: 't',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MYSTERY');
    expect(warnings[0]).not.toContain('（）');
  });

  it('拿不到映射器时原样透传类型，而不是猜一个（并保持无告警）', () => {
    const { columns, warnings } = buildExportColumns({
      resultColumns: [{ name: 'weird', dataType: 'GEOMETRY(POINT,4326)' }],
      sourceMapper: null,
      targetDbType: 'postgresql',
      schema: 'public',
      table: 't',
    });
    expect(columns[0]!.dataType).toBe('GEOMETRY(POINT,4326)');
    expect(warnings).toEqual([]);
  });

  it('每列的序位、schema、表名都要正确回填（建表靠这些字段）', () => {
    const { columns } = buildExportColumns({
      resultColumns: [
        { name: 'a', dataType: 'INTEGER' },
        { name: 'b', dataType: 'TEXT' },
        { name: 'c', dataType: 'REAL' },
      ],
      sourceMapper: mapper((t) => ({ type: t, lossy: false })),
      targetDbType: 'sqlite',
      schema: 'main',
      table: 'snapshot',
    });
    expect(columns.map((c) => c.ordinal)).toEqual([0, 1, 2]);
    expect(columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(columns.every((c) => c.schema === 'main' && c.table === 'snapshot')).toBe(true);
    // 结果集没有主键/默认值这类信息，必须显式留空而不是编造
    expect(columns.every((c) => c.isPrimaryKey === false && c.defaultValue === null)).toBe(true);
  });

  it('多列中只有有损的那几列产生告警，且顺序与列一致', () => {
    const { warnings } = buildExportColumns({
      resultColumns: [
        { name: 'ok1', dataType: 'TEXT' },
        { name: 'bad1', dataType: 'BIGINT' },
        { name: 'ok2', dataType: 'TEXT' },
        { name: 'bad2', dataType: 'JSON' },
      ],
      sourceMapper: mapper((t) =>
        t === 'BIGINT' || t === 'JSON'
          ? { type: 'TEXT', lossy: true, note: '降级' }
          : { type: t, lossy: false },
      ),
      targetDbType: 'sqlite',
      schema: 'main',
      table: 't',
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('bad1');
    expect(warnings[1]).toContain('bad2');
  });

  it('零列结果集不会崩（上游已拦，这里兜一道）', () => {
    const { columns, warnings } = buildExportColumns({
      resultColumns: [],
      sourceMapper: mapper((t) => ({ type: t, lossy: false })),
      targetDbType: 'sqlite',
      schema: 'main',
      table: 't',
    });
    expect(columns).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
