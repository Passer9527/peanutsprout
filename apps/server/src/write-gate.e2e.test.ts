/**
 * 花生苗数据库管理工具 - 写闸门端到端回归
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个文件专门固定「写闸门在 HTTP 层真的拦得住」这件事。
 *
 * 为什么单独一个文件：写闸门只有 `isWriteStatement` 这一道判据，
 * 它一旦漏判，「query.write 权限 / 连接只读 / 资源授权 / 二次确认」四道闸门
 * 会**同时**失效。第二轮对抗性安全验证真实复现了多种绕过（PostgreSQL 的数据
 * 修改 CTE 甚至真的删掉了数据），因此这里用真实 HTTP 请求把每种手法都钉住：
 *
 *   · 只读账号提交该语句 → 必须 403（并且库里数据一行都不能少）
 *   · 管理员提交同一条语句但不带 confirm → 必须 428（证明它被判成了写）
 *
 * 断言的重点是「该拒绝的必须被拒绝」，而不是「功能能用」。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import type { ServerConfig } from './config.js';

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

/** 直接读目标库，确认数据没被改动（不经过被测代码，避免"自己验自己"）。 */
function rowCount(): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number };
    return Number(row.n);
  } finally {
    db.close();
  }
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(res.statusCode, `${username} 登录失败: ${res.body}`).toBe(200);
  return res.json().token as string;
}

/**
 * 这些语句都是**真正会改数据或结构**的，只是写得不那么直白。
 * 每一条都对应一次真实的绕过尝试（或一个常见方言写法）。
 */
const WRITE_BYPASSES: Array<{ name: string; sql: string }> = [
  {
    name: 'PostgreSQL 数据修改 CTE（DELETE 藏在 CTE 体里）',
    sql: 'WITH w AS (DELETE FROM t RETURNING *) SELECT count(*) AS n FROM w',
  },
  {
    name: 'PostgreSQL 数据修改 CTE（INSERT 藏在 CTE 体里）',
    sql: 'WITH w AS (INSERT INTO t(v) VALUES (999) RETURNING *) SELECT v FROM w',
  },
  {
    name: 'PostgreSQL 的 SELECT ... INTO（会建表）',
    sql: 'SELECT * INTO sneaky_copy FROM t',
  },
  {
    name: 'MySQL 可执行版本注释（整条语句就是一条注释）',
    sql: '/*!50000 DROP TABLE t */',
  },
  {
    name: 'MySQL 可执行版本注释（混在只读语句后面）',
    sql: 'SELECT 1; /*!50000 DROP TABLE t */',
  },
  {
    name: 'MySQL 的 -- 不是注释（--1 会被当成减负数）',
    sql: 'SELECT 1--1; DROP TABLE t',
  },
  {
    name: '分号多语句：先只读后写',
    sql: 'SELECT 1; DROP TABLE t',
  },
  {
    name: '全角关键字（解析不出动词时必须按写处理）',
    sql: 'ＤＥＬＥＴＥ FROM t',
  },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-wgate-'));
  dbPath = join(dir, 'target.db');

  // 先在目标库建好表并写入 3 行，作为"数据有没有被改坏"的基准
  const seed = new DatabaseSync(dbPath);
  seed.exec('CREATE TABLE t (v INTEGER)');
  seed.exec('INSERT INTO t (v) VALUES (1), (2), (3)');
  seed.close();

  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  adminToken = await login(ADMIN, ADMIN_PASSWORD);

  const conn = await app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: auth(adminToken),
    payload: { name: '写闸门目标库', dbType: 'sqlite', databaseName: dbPath },
  });
  expect(conn.statusCode, conn.body).toBe(201);
  connectionId = conn.json().item.id as number;

  const user = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(adminToken),
    payload: { username: 'wg-readonly', password: 'Re@d0nly-Pass!', roles: ['readonly'] },
  });
  expect(user.statusCode, user.body).toBe(201);
  readonlyToken = await login('wg-readonly', 'Re@d0nly-Pass!');
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

describe('写闸门：绕过手法必须被拦在 HTTP 层', () => {
  it('只读账号提交每一种绕过语句都被拒，且库里数据一行未少', async () => {
    expect(rowCount(), '前置条件：目标表应有 3 行').toBe(3);

    for (const { name, sql } of WRITE_BYPASSES) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/query/execute',
        headers: auth(readonlyToken),
        payload: { connectionId, sql },
      });
      // 只读账号（无 query.write）必须被拒；200 意味着语句真的跑到了数据库上
      expect(res.statusCode, `【${name}】没有被拦住: ${res.statusCode} ${res.body}`).toBe(403);
      // 关键：不能只是"报错"，还得确认它没有产生任何副作用
      expect(rowCount(), `【${name}】执行后数据被改动了`).toBe(3);
    }

    // 表本身也必须还在（DROP TABLE 是否被拦住）
    const probe = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId, sql: 'SELECT COUNT(*) AS n FROM t' },
    });
    expect(probe.statusCode, `目标表 t 不见了: ${probe.body}`).toBe(200);
  });

  it('管理员提交同一条语句会被要求二次确认（证明它被判成了写）', async () => {
    for (const { name, sql } of WRITE_BYPASSES) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/query/execute',
        headers: auth(adminToken),
        payload: { connectionId, sql },
      });
      // 428 = 判成了写但缺 confirm。若返回 200，说明写闸门漏判；
      // 若返回其它错误，说明是被别的原因挡下的（那这条语句就没有验证到写判定）。
      expect(res.statusCode, `【${name}】未被判定为写操作: ${res.statusCode} ${res.body}`).toBe(428);
    }
    expect(rowCount()).toBe(3);
  });

  it('反向回归：真正的只读查询对只读账号必须放行', async () => {
    for (const sql of [
      'SELECT * FROM t',
      'SELECT 1',
      'EXPLAIN SELECT * FROM t',
      'WITH x AS (SELECT 1 AS a) SELECT a FROM x',
      'SELECT /*!40001 SQL_NO_CACHE */ v FROM t',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/query/execute',
        headers: auth(readonlyToken),
        payload: { connectionId, sql },
      });
      expect(res.statusCode, `只读查询被误拦: ${sql} → ${res.statusCode} ${res.body}`).toBe(200);
    }
  });

  it('带上 confirm 后只读账号依然不能写（confirm 不是绕过权限的后门）', async () => {
    for (const { name, sql } of WRITE_BYPASSES) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/query/execute',
        headers: auth(readonlyToken),
        payload: { connectionId, sql, confirm: true },
      });
      expect(res.statusCode, `【${name}】加上 confirm 后被放行了`).toBe(403);
      expect(rowCount(), `【${name}】加上 confirm 后数据被改动了`).toBe(3);
    }
  });
});

/**
 * 被写闸门拒绝的尝试**必须留下审计**。
 *
 * 修复前 403（权限不足）/ 428（缺 confirm）/ READONLY_VIOLATION 三种拒绝
 * 都不写任何审计记录 —— 而"谁试图写却被拦下"恰恰是入侵检测最有价值的信号。
 * 这里把三种拒绝路径都钉住，并验证它能与"根本没提交写语句"区分开。
 */
describe('写闸门：被拒绝的写尝试要进审计', () => {
  /** 取该用户最近的 denied 审计记录（detail 是 JSON 字符串，要解析回来）。 */
  function deniedEntries(): Array<{ gate: string; confirmed: boolean; errorMessage: string }> {
    const rows = ctx.pdb.db.all<{ detail: string | null; error_message: string | null; status: string }>(
      "SELECT detail, error_message, status FROM audit_logs WHERE status = 'denied' ORDER BY id",
    );
    return rows.map((r) => {
      const detail = r.detail ? (JSON.parse(r.detail) as { gate?: string; confirmed?: boolean }) : {};
      return {
        gate: detail.gate ?? '',
        confirmed: detail.confirmed ?? false,
        errorMessage: r.error_message ?? '',
      };
    });
  }

  it('403（只读账号缺 query.write）会留下 denied 审计', async () => {
    const before = deniedEntries().length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(readonlyToken),
      payload: { connectionId, sql: 'DELETE FROM t' },
    });
    expect(res.statusCode, res.body).toBe(403);

    const after = deniedEntries();
    expect(after.length, '被拒绝的写操作没有留下审计').toBe(before + 1);
    const last = after[after.length - 1]!;
    // 记录里要能看出"是哪个闸门拦的"
    expect(last.gate).toBe('AUTH_FORBIDDEN');
    expect(last.confirmed).toBe(false);
  });

  it('428（管理员提交写语句但缺 confirm）会留下 denied 审计，且能与"没提交写语句"区分', async () => {
    const before = deniedEntries().length;

    // ① 管理员提交写语句但不带 confirm → 428 + denied
    const missingConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId, sql: 'DELETE FROM t' },
    });
    expect(missingConfirm.statusCode, missingConfirm.body).toBe(428);
    const withConfirmAttempt = deniedEntries();
    expect(withConfirmAttempt.length, '缺 confirm 的写尝试没有留下审计').toBe(before + 1);
    expect(withConfirmAttempt[withConfirmAttempt.length - 1]!.gate).toBe('CONFIRMATION_REQUIRED');

    // ② 同一用户执行只读查询 → denied 计数不变（"没提交写语句"不会留下 denied）
    const read = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId, sql: 'SELECT COUNT(*) AS n FROM t' },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(deniedEntries().length, '只读查询不应该产生 denied 记录').toBe(before + 1);
  });

  it('denied 审计里的错误说明不含敏感内容', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(readonlyToken),
      payload: { connectionId, sql: "DELETE FROM t WHERE v = 'topsecret'" },
    });
    const messages = deniedEntries().map((d) => d.errorMessage);
    expect(messages.length).toBeGreaterThan(0);
    // 错误说明是固定文案，不回显原始 SQL（否则等于把用户数据写进审计）
    for (const m of messages) {
      expect(m).not.toContain('topsecret');
      expect(m).not.toContain('DELETE');
    }
  });

  it('拒绝写操作不会破坏审计链', async () => {
    const chain = ctx.pdb.audit.verifyChain();
    expect(chain.ok, `审计链被拒绝路径写坏了: ${JSON.stringify(chain)}`).toBe(true);
  });
});
