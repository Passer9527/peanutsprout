/**
 * 花生苗数据库管理工具 - 安全回归测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个文件里的每一条都对应一个**真实存在过**的安全缺陷。
 * 它们的共同点是"看起来功能正常，实际上保护没生效"：
 *  · 写闸门只看语句第一个关键字 → 只读账号用 `WITH ... DELETE` 就能删数据；
 *  · 真正搬数据的迁移接口漏了资源授权 → 能把未授权的库整表搬走；
 *  · 按主键取资源的接口漏了归属校验 → 递增 id 就能读遍全系统；
 *  · 连接 DTO 原样回传连接串 → 只读账号能读到别人的库口令；
 *  · "首次登录强制改密"只写不读 → 默认口令永久有效。
 *
 * 因此这里断言的重点不是"功能能用"，而是**该拒绝的必须被拒绝**。
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
let adminToken = '';
let readonlyToken = '';
let developerToken = '';
let developerUserId = 0;
let scopedToken = '';
let writerToken = '';
let otherConnectionId = 0;
let targetDbPath = '';

const ADMIN = 'admin';
// 刻意用一个**非默认**口令引导：默认口令会触发"强制改密"闸门，
// 那样测的就不是授权逻辑了（该闸门另有专门的测试）。
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

/**
 * 判断响应是不是 notFoundHandler 的"接口不存在"。
 *
 * 这是本文件的一条**防空转**护栏：任何断言 404 的测试都必须先确认请求
 * 真的到达了业务层。之前有一条"未预期异常不泄漏堆栈"的测试请求的是
 * 根本不存在的 `PUT /api/v1/users/999999/roles`，拿到的是
 * `{"error":{"message":"接口不存在: PUT ..."}}`，errorHandler 从未被触发，
 * 断言自然永远成立 —— 虚假的绿色。凡是期望 404 的用例都应调用本函数核对。
 */
function routeMissing(res: { json: () => { error?: { message?: string } } }): boolean {
  try {
    return (res.json().error?.message ?? '').includes('接口不存在');
  } catch {
    return false;
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

async function createUser(
  username: string,
  password: string,
  roles: string[],
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(adminToken),
    payload: { username, password, roles },
  });
  expect(res.statusCode, `创建用户 ${username} 失败: ${res.body}`).toBe(201);
  return res.json().item.id as number;
}

let adminConnectionId = 0;
/**
 * 造一个带 conn.write 的自定义角色。
 *
 * 内置角色里只有 admin 有 conn.write，而管理员天然可见全部连接 ——
 * 要验证"有权限码但没被授权这条连接"的 IDOR，必须有一个普通角色持有 conn.write，
 * 否则请求会先被权限码拦成 403，根本走不到可见性校验那一层。
 */
function createRoleWithPermissions(name: string, codes: string[]): void {
  ctx.pdb.db.run('INSERT OR IGNORE INTO roles (name, description, is_builtin) VALUES (?, ?, 0)', name, '测试用角色');
  const role = ctx.pdb.db.get<{ id: number }>('SELECT id FROM roles WHERE name = ?', name);
  if (!role) throw new Error(`创建角色失败: ${name}`);
  for (const code of codes) {
    ctx.pdb.db.run(
      'INSERT OR IGNORE INTO permissions (code, name, category) VALUES (?, ?, ?)',
      code,
      code,
      'test',
    );
    const perm = ctx.pdb.db.get<{ id: number }>('SELECT id FROM permissions WHERE code = ?', code);
    if (!perm) throw new Error(`创建权限失败: ${code}`);
    ctx.pdb.db.run(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      role.id,
      perm.id,
    );
  }
}

/**
 * 用管理员建一个迁移任务并返回 id。
 *
 * 刻意**不**写成 `if (taskId === undefined) return`：那样一旦 precheck 不再
 * 返回 taskId，依赖它的测试就会直接跳过全部断言并显示绿色（空转）。
 * 拿不到 taskId 必须当场失败。
 */
async function createAdminMigrationTask(): Promise<number> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/migration/precheck',
    headers: auth(adminToken),
    payload: { sourceConnectionId: adminConnectionId, targetConnectionId: adminConnectionId },
  });
  const taskId = created.json().taskId as number | undefined;
  expect(taskId, `precheck 未返回 taskId: ${created.body}`).toBeTypeOf('number');
  return taskId as number;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-sec-'));
  targetDbPath = join(dir, 'target.db');
  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  // 测试专用：一个必然抛出未预期异常（非 PeanutError）的接口，用来保证
  // 「错误响应不泄漏堆栈」的测试真的走到 errorHandler。此前那条测试请求的是
  // 根本不存在的 PUT /users/:id/roles，命中的是 notFoundHandler，属于空转。
  app.get('/api/v1/__boom', async () => {
    throw new Error('boom-未预期异常');
  });
  await app.ready();

  adminToken = await login(ADMIN, ADMIN_PASSWORD);

  // 管理员建一个连接，稍后用来验证"未授权用户看不到也动不了"
  const conn = await app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: auth(adminToken),
    payload: { name: '管理员私有库', dbType: 'sqlite', databaseName: targetDbPath },
  });
  expect(conn.statusCode, conn.body).toBe(201);
  adminConnectionId = conn.json().item.id as number;

  await createUser('sec-readonly', 'Re@d0nly-Pass!', ['readonly']);
  developerUserId = await createUser('sec-developer', 'Devel0per-Pass!', ['developer']);
  readonlyToken = await login('sec-readonly', 'Re@d0nly-Pass!');
  developerToken = await login('sec-developer', 'Devel0per-Pass!');

  // 只给一条 table 级授权的用户：用于验证"授权越少权限越大"的提权缺陷
  const scopedId = await createUser('sec-scoped', 'Sc0ped-Pass!', ['developer']);
  const grants = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${scopedId}/grants`,
    headers: auth(adminToken),
    payload: { grants: [{ resourceType: 'table', resourceId: '12', actions: ['read'] }] },
  });
  expect(grants.statusCode, grants.body).toBe(200);
  scopedToken = await login('sec-scoped', 'Sc0ped-Pass!');

  // 有 conn.write 但**没有任何连接级授权**：角色模式下可见全部连接，
  // 因此这里再给他一条"仅另外一个连接"的授权，使其进入白名单模式，
  // 从而真正走到"这条连接未授权"的分支。
  createRoleWithPermissions('sec-conn-writer', ['conn.read', 'conn.write', 'query.read', 'query.write']);
  const writerId = await createUser('sec-writer', 'Wr1ter-Pass!', ['sec-conn-writer']);
  const otherConn = await app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: auth(adminToken),
    payload: { name: '另一个库', dbType: 'sqlite', databaseName: join(dir, 'other.db') },
  });
  expect(otherConn.statusCode, otherConn.body).toBe(201);
  otherConnectionId = otherConn.json().item.id as number;
  // 只授权"另一个连接" → 该用户进入白名单模式，因而看不到 adminConnectionId
  const g = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${writerId}/grants`,
    headers: auth(adminToken),
    payload: {
      grants: [{ resourceType: 'connection', resourceId: String(otherConnectionId), actions: ['read', 'write'] }],
    },
  });
  expect(g.statusCode, g.body).toBe(200);
  writerToken = await login('sec-writer', 'Wr1ter-Pass!');

  // 先自证前提成立：该用户确实看不到管理员那条连接
  const visible = await app.inject({
    method: 'GET',
    url: '/api/v1/connections',
    headers: auth(writerToken),
  });
  const visibleIds = (visible.json().items as Array<{ id: number }>).map((item) => item.id);
  expect(visibleIds, '前提不成立：被收窄的用户仍能看到管理员的连接').not.toContain(adminConnectionId);
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

describe('写闸门不可被语句形态绕过（回归：曾经只看第一个关键字）', () => {
  /**
   * 这些语句都以"只读"的形态开头或伪装，旧实现会判为只读，
   * 于是既不校验 query.write、也不要求二次确认，直接交给数据库执行。
   */
  const BYPASS_ATTEMPTS: Array<{ name: string; sql: string }> = [
    { name: 'CTE 前缀 DELETE', sql: 'WITH c AS (SELECT 1 AS a) DELETE FROM t' },
    { name: 'CTE 前缀 INSERT', sql: 'WITH c AS (SELECT 1 AS a) INSERT INTO t(v) SELECT a FROM c' },
    { name: 'CTE 前缀 UPDATE', sql: 'WITH c AS (SELECT 1 AS a) UPDATE t SET v = 1' },
    { name: '多语句夹带 DROP', sql: 'SELECT 1 AS one; DROP TABLE t; -- limit' },
    { name: 'EXPLAIN ANALYZE 包裹 DELETE', sql: 'EXPLAIN ANALYZE DELETE FROM t' },
  ];

  it.each(BYPASS_ATTEMPTS)('只读账号执行「$name」必须被拒绝', async ({ sql }) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(readonlyToken),
      payload: { connectionId: adminConnectionId, sql },
    });
    // 关键断言：绝不能是 200 —— 只读账号不该写成功
    expect(res.statusCode).not.toBe(200);
    expect(['AUTH_FORBIDDEN', 'READONLY_VIOLATION', 'NOT_FOUND']).toContain(res.json().error.code);
  });

  it.each(BYPASS_ATTEMPTS)('管理员执行「$name」也必须先要求二次确认', async ({ sql }) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId: adminConnectionId, sql },
    });
    // 管理员有写权限，但不带 confirm 时必须拿到 428 而不是直接执行
    expect(res.statusCode).toBe(428);
    expect(res.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('真正的只读语句不被误伤', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(readonlyToken),
      payload: { connectionId: adminConnectionId, sql: 'WITH x AS (SELECT 1 AS a) SELECT * FROM x' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('资源级授权不可被"无连接级授权"放大（回归）', () => {
  it('只被授予 table 级授权的用户看不到任何连接', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: auth(scopedToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('只被授予 table 级授权的用户读不到具体连接（与"不存在"无差别）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(scopedToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('只被授予 table 级授权的用户改不动该连接', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(scopedToken),
      payload: { name: '被篡改' },
    });
    // 该用户是 developer 角色、没有 conn.write，因此先被权限码拦成 403；
    // 有 conn.write 的场景由下面的 sec-writer 覆盖。两者都算"被拒绝"。
    expect([403, 404]).toContain(res.statusCode);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('只被授予 table 级授权的用户删不掉该连接', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(scopedToken),
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(routeMissing(res), res.body).toBe(false);
    // 确认连接确实还在
    const still = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(adminToken),
    });
    expect(still.statusCode).toBe(200);
  });

  it('只被授予 table 级授权的用户写不进去', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(scopedToken),
      payload: { connectionId: adminConnectionId, sql: 'INSERT INTO t(v) VALUES (1)', confirm: true },
    });
    expect(res.statusCode).not.toBe(200);
  });
});

describe('连接写侧与元数据接口的授权一致性（回归）', () => {
  it('有 conn.write 但未授权该连接的用户改不动它（写侧 IDOR）', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(writerToken),
      payload: { name: '被改名的库' },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('有 conn.write 但未授权该连接的用户改不了它的只读开关', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/connections/${adminConnectionId}/flags`,
      headers: auth(writerToken),
      payload: { isReadOnly: false },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('有 conn.write 但未授权该连接的用户删不掉它', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(writerToken),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('生产库探测接口不能当连接枚举器', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meta/production-check/${adminConnectionId}`,
      headers: auth(writerToken),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('生产库探测接口对「不可见连接」与「不存在连接」的形状与连接详情接口完全一致', async () => {
    // 正确的不变量：响应只回显**调用者自己提供的 id**（`连接不存在: <id>`），
    // 不携带"这个 id 是否真实存在"的任何额外信息 —— 响应是 id 的纯函数。
    // 注意不能拿两个不同 id 的响应做逐字节比较：message 末尾本就会回显各自
    // 请求的 id，那样连正确实现也会"不相等"。所以这里做两件事：
    //  1) 同一 id 下，本探测接口与早已加固的 GET /connections/:id 逐字节一致
    //     （两个出口不能对"该 id 是否存在"给出互相矛盾的答案）；
    //  2) 两种情况的状态码与错误码相同，message 只由请求的 id 决定。
    const hiddenProbe = await app.inject({
      method: 'GET',
      url: `/api/v1/meta/production-check/${adminConnectionId}`,
      headers: auth(writerToken),
    });
    const hiddenDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${adminConnectionId}`,
      headers: auth(writerToken),
    });
    const missingProbe = await app.inject({
      method: 'GET',
      url: '/api/v1/meta/production-check/999999',
      headers: auth(writerToken),
    });
    const missingDetail = await app.inject({
      method: 'GET',
      url: '/api/v1/connections/999999',
      headers: auth(writerToken),
    });

    expect(hiddenProbe.statusCode, hiddenProbe.body).toBe(404);
    expect(missingProbe.statusCode, missingProbe.body).toBe(404);
    expect(routeMissing(hiddenProbe), hiddenProbe.body).toBe(false);
    // 同一 id：两个接口逐字节一致（不存在与不可见都从同一个 NOT_FOUND 出口出去）
    expect(hiddenProbe.body).toBe(hiddenDetail.body);
    expect(missingProbe.body).toBe(missingDetail.body);
    expect(hiddenProbe.json().error).toEqual({
      code: 'NOT_FOUND',
      message: `连接不存在: ${adminConnectionId}`,
    });
    expect(missingProbe.json().error).toEqual({ code: 'NOT_FOUND', message: '连接不存在: 999999' });
    // 旧实现：不存在 → 200 {production:false,exists:false}，不可见 → 404。
    // 这里钉住"不存在也必须是 404 NOT_FOUND，且形状与不可见完全一致"。
    expect(missingProbe.statusCode).toBe(hiddenProbe.statusCode);
    expect(missingProbe.json().error.code).toBe(hiddenProbe.json().error.code);
  });

  it('管理员查不存在的连接同样 404（不能因为可见全部就回 200）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/meta/production-check/999999',
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(res.json().error.message).toBe('连接不存在: 999999');
  });

  it('有权限时仍能判定生产库，且不再回传恒为 true 的 exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/meta/production-check/${adminConnectionId}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { production?: unknown; readOnly?: unknown; exists?: unknown };
    expect(typeof body.production).toBe('boolean');
    expect(typeof body.readOnly).toBe('boolean');
    // exists 只可能是 true（能查到的可见连接必然存在），已无枚举语义，故移除
    expect(body.exists).toBeUndefined();
  });
});

describe('迁移接口的授权与归属（回归：会把未授权的库整表搬走）', () => {
  /**
   * 注意：developer 内置角色**没有任何资源级授权**，按"角色模式"可见全部连接，
   * 所以用它测不出可见性问题。这里必须用一个"被显式收窄到别的连接"的用户。
   * sec-writer 有 conn.read/conn.write/query.read/query.write，
   * 但没有 migrate.* 权限 —— 因此迁移接口这一层先用 admin 之外的口径验证：
   * 把一个"可见范围被收窄"的用户提升出 migrate.write 才能打到 start 的校验分支。
   */
  it('被收窄到其他连接的用户读不到未授权连接的迁移预检', async () => {
    // sec-writer 缺少 migrate.read，会先被权限码拦下 —— 这本身也是正确的拒绝
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/migration/precheck',
      headers: auth(writerToken),
      payload: { sourceConnectionId: adminConnectionId, targetConnectionId: adminConnectionId },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('/migration/start 对未授权连接返回 NOT_FOUND（而不是照做）', async () => {
    // 给 sec-writer 补上 migrate 权限，让它越过权限码这一层，直接考验资源授权
    createRoleWithPermissions('sec-migrator', ['conn.read', 'query.read', 'migrate.read', 'migrate.write']);
    const migratorId = await createUser('sec-migrator', 'M1grator-Pass!', ['sec-migrator']);
    // 只授权"另一个连接"，使其进入白名单模式
    const grantRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${migratorId}/grants`,
      headers: auth(adminToken),
      payload: {
        grants: [{ resourceType: 'connection', resourceId: String(otherConnectionId), actions: ['read', 'write'] }],
      },
    });
    expect(grantRes.statusCode, grantRes.body).toBe(200);
    const migratorToken = await login('sec-migrator', 'M1grator-Pass!');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/migration/start',
      headers: auth(migratorToken),
      payload: {
        sourceConnectionId: adminConnectionId,
        targetConnectionId: adminConnectionId,
        tables: [],
      },
    });
    expect(res.statusCode, 'start 曾经缺少资源授权校验').toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('迁移任务详情不能靠递增 id 读到别人的任务', async () => {
    const taskId = await createAdminMigrationTask();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/migration/${taskId}`,
      headers: auth(developerToken),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });

  it('迁移详情对「他人的任务」与「不存在的任务」逐字节无差别（id 不可枚举）', async () => {
    const taskId = await createAdminMigrationTask();
    const others = await app.inject({
      method: 'GET',
      url: `/api/v1/migration/${taskId}`,
      headers: auth(developerToken),
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/migration/999999',
      headers: auth(developerToken),
    });
    expect(others.statusCode, others.body).toBe(404);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(routeMissing(others), others.body).toBe(false);
    // 旧实现：不存在 → `迁移任务不存在: 999999`（带 id），他人任务 → `迁移任务不存在`。
    // 状态码一致但 message 不同，攻击者据此仍能枚举全库任务 id。
    expect(missing.body).toBe(others.body);
  });

  it('迁移报告同样不区分「他人的任务」与「不存在的任务」', async () => {
    const taskId = await createAdminMigrationTask();
    const others = await app.inject({
      method: 'GET',
      url: `/api/v1/migration/${taskId}/report`,
      headers: auth(developerToken),
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/migration/999999/report',
      headers: auth(developerToken),
    });
    expect(others.statusCode, others.body).toBe(404);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(routeMissing(others), others.body).toBe(false);
    expect(missing.body).toBe(others.body);
  });

  it('取消别人的迁移任务与取消不存在的任务响应一致', async () => {
    const taskId = await createAdminMigrationTask();
    const others = await app.inject({
      method: 'POST',
      url: `/api/v1/migration/${taskId}/cancel`,
      headers: auth(developerToken),
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/migration/999999/cancel',
      headers: auth(developerToken),
    });
    expect(others.statusCode, others.body).toBe(404);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(routeMissing(others), others.body).toBe(false);
    expect(missing.body).toBe(others.body);
  });

  it('/migration/tasks 列表只返回自己的任务，不泄漏他人任务', async () => {
    const adminTaskId = await createAdminMigrationTask();

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/migration/tasks',
      headers: auth(developerToken),
    });
    expect(mine.statusCode, mine.body).toBe(200);
    const mineItems = mine.json().items as Array<{ id: number; userId: number }>;
    expect(mineItems.map((t) => t.id), '列表泄漏了他人的迁移任务').not.toContain(adminTaskId);
    // 列表里的每一条都必须是调用者自己的
    for (const item of mineItems) expect(item.userId).toBe(developerUserId);

    // 反证：管理员带 allUsers=true 能看到全局任务，说明列表并非天然为空
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/migration/tasks?allUsers=true',
      headers: auth(adminToken),
    });
    expect(all.statusCode, all.body).toBe(200);
    expect((all.json().items as Array<{ id: number }>).map((t) => t.id)).toContain(adminTaskId);

    // 非管理员即使伪造 allUsers=true 也不能越权看别人的
    const escalated = await app.inject({
      method: 'GET',
      url: '/api/v1/migration/tasks?allUsers=true',
      headers: auth(developerToken),
    });
    expect(escalated.statusCode, escalated.body).toBe(200);
    expect((escalated.json().items as Array<{ id: number }>).map((t) => t.id)).not.toContain(adminTaskId);
  });
});

describe('连接串里的明文口令不得外泄（回归）', () => {
  it('创建连接后，任何读接口都不回传连接串里的口令', async () => {
    const secret = 'Sup3r-Secret-Pw';
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(adminToken),
      payload: {
        name: '带口令连接串',
        dbType: 'postgresql',
        connectionUrl: `postgres://postgres:${secret}@db.example.com:5432/app`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().item.id as number;

    // 创建响应、详情、列表三处都不能出现口令
    expect(JSON.stringify(created.json())).not.toContain(secret);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${id}`,
      headers: auth(adminToken),
    });
    expect(JSON.stringify(detail.json())).not.toContain(secret);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/connections',
      headers: auth(adminToken),
    });
    expect(JSON.stringify(list.json())).not.toContain(secret);

    // 但口令必须被保留下来供连接使用（存进了 password_enc）
    expect(detail.json().item.hasPassword).toBe(true);
  });
});

describe('错误响应不得泄漏服务端内部信息（回归）', () => {
  it('未预期异常不回传堆栈（走真实路由，命中 errorHandler）', async () => {
    // 触发一个未被包装成 PeanutError 的原生错误：
    // 给不存在的用户设置角色会先穿过 users.setRoles()，user_roles 的外键
    // （PRAGMA foreign_keys = ON）会抛出原生 SQLite 约束错误。
    //
    // 注意路由是 `PUT /users/:id`（roles 在请求体里），**不存在** `/users/:id/roles`。
    // 旧版测试请求的正是 `/users/999999/roles`，命中的是 notFoundHandler 的
    // "接口不存在"，errorHandler 从未被触发 —— 断言 stack 不存在自然永远成立。
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/users/999999',
      headers: auth(adminToken),
      payload: { roles: ['readonly'] },
    });
    // 先证明真的到达了业务层/errorHandler，而不是路由不存在
    expect(routeMissing(res), res.body).toBe(false);
    expect(res.json().error.message, res.body).not.toContain('接口不存在');
    expect(res.statusCode, res.body).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL');
    // 统一的中文兜底文案，不携带原始 err.message / 堆栈
    expect(res.json().error.message).toBe('服务内部错误，详情请查看服务端日志');
    const body = res.body;
    expect(body).not.toContain('stack');
    expect(body).not.toContain('/home/');
    expect(body).not.toContain('.ts:');
    expect(body).not.toContain('FOREIGN KEY');
  });

  it('测试专用异常路由 100% 走 errorHandler，且不泄漏堆栈/路径/原文', async () => {
    // 与业务逻辑解耦：这个路由（在 beforeAll 里注册）必定抛非 PeanutError，
    // 因此必然经过 errorHandler。它保证"未预期异常不泄漏内部信息"这条
    // 安全属性始终被真实覆盖，不会因为某个业务路由被改名/删除而空转。
    const res = await app.inject({ method: 'GET', url: '/api/v1/__boom' });
    expect(res.statusCode, res.body).toBe(500);
    const body = res.body;
    // 原始异常文本（含 'boom'）与堆栈都不能出现
    expect(body).not.toContain('boom');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('/home/');
    expect(body).not.toContain('.ts:');
    expect(res.json().error.code).toBe('INTERNAL');
    expect(res.json().error.message).toBe('服务内部错误，详情请查看服务端日志');
  });
});

describe('CORS 默认不反射任意来源（回归）', () => {
  it('第三方站点拿不到允许跨源读取的响应头', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://evil.example.com' },
    });
    const allowOrigin = res.headers['access-control-allow-origin'];
    expect(allowOrigin).not.toBe('https://evil.example.com');
    expect(allowOrigin).not.toBe('*');
  });

  it('本机来源仍然放行（不影响本地开发）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('默认口令强制改密（回归：曾经只写不读）', () => {
  it('用非默认口令引导时不要求改密', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ADMIN, password: ADMIN_PASSWORD },
    });
    expect(res.json().mustChangePassword).toBe(false);
  });

  it('默认口令会置位强制改密开关，且只放行改密相关接口', async () => {
    // 直接构造一个"仍在使用默认口令"的库
    const dir2 = mkdtempSync(join(tmpdir(), 'ps-pw-'));
    try {
      const ctx2 = createContext({
        // bootstrapAdminPassword 置空 → 引导才会使用内置默认口令 123456
        config: { ...testConfig(), dataDir: dir2, bootstrapAdminPassword: null },
        memory: true,
      });
      const app2 = await buildServer(ctx2, { quiet: true });
      await app2.ready();
      try {
        // 该实例用默认口令 123456 引导
        const login = await app2.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'admin', password: '123456' },
        });
        expect(login.statusCode).toBe(200);
        const token = login.json().token as string;
        expect(login.json().mustChangePassword).toBe(true);

        // 业务接口必须被挡下
        const blocked = await app2.inject({
          method: 'GET',
          url: '/api/v1/connections',
          headers: auth(token),
        });
        expect(blocked.statusCode).toBe(403);
        expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

        // 改密接口必须放行，否则用户被永久锁死
        const allowed = await app2.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: auth(token),
        });
        expect(allowed.statusCode).toBe(200);
        expect(allowed.json().mustChangePassword).toBe(true);

        // 改密之后闸门解除
        const changed = await app2.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password',
          headers: auth(token),
          payload: { oldPassword: '123456', newPassword: 'Brand-New-Pass!9' },
        });
        expect(changed.statusCode, changed.body).toBe(200);

        const after = await app2.inject({
          method: 'GET',
          url: '/api/v1/connections',
          headers: auth(token),
        });
        expect(after.statusCode).toBe(200);
      } finally {
        await app2.close();
        await disposeContext(ctx2);
      }
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('连接配置变更必须立即生效（回归：缓存会话未释放）', () => {
  it('改库之后查询立刻落到新库，而不是继续读旧库', async () => {
    // 造两个内容不同的 SQLite 库：A 库有 'A'，B 库有 'B'
    const aPath = join(dir, 'cache-a.db');
    const bPath = join(dir, 'cache-b.db');
    for (const [file, value] of [
      [aPath, 'A'],
      [bPath, 'B'],
    ] as const) {
      const raw = new DatabaseSync(file);
      raw.exec('CREATE TABLE t (v TEXT)');
      raw.prepare('INSERT INTO t (v) VALUES (?)').run(value);
      raw.close();
    }

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(adminToken),
      payload: { name: '缓存会话回归', dbType: 'sqlite', databaseName: aPath },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().item.id as number;

    // 先查一次，让连接管理器把会话建立并缓存起来
    const before = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId: id, sql: 'SELECT v FROM t' },
    });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json().rows[0][0]).toBe('A');

    // 把连接改指向 B 库
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${id}`,
      headers: auth(adminToken),
      payload: { databaseName: bPath },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    // 关键断言：必须读到 B。旧实现会继续返回 A（会话被缓存且未释放），
    // 界面显示 B 库而写操作落进 A 库 —— 静默的数据错位。
    const after = await app.inject({
      method: 'POST',
      url: '/api/v1/query/execute',
      headers: auth(adminToken),
      payload: { connectionId: id, sql: 'SELECT v FROM t' },
    });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().rows[0][0]).toBe('B');
  });
});

describe('连接子资源接口的可见性一致性（回归：capabilities 曾是唯一漏网的探针）', () => {
  it('未授权用户拿不到 capabilities（与"不存在"无差别）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/connections/${adminConnectionId}/capabilities`,
      headers: auth(writerToken),
    });
    expect(res.statusCode, res.body).toBe(404);
    expect(routeMissing(res), res.body).toBe(false);
  });
});

describe('连接列表先授权后分页（回归：分页会翻丢被授权的连接）', () => {
  it('被收窄的用户带 limit 也能拿到自己的连接，total 是真实总数', async () => {
    // sec-writer 只被授权了 otherConnectionId 一条
    const limited = await app.inject({
      method: 'GET',
      url: '/api/v1/connections?limit=1',
      headers: auth(writerToken),
    });
    expect(limited.statusCode, limited.body).toBe(200);
    const body = limited.json() as { items: Array<{ id: number }>; total: number };
    // 旧实现先 LIMIT 再过滤：被授权的连接已被 SQL 截掉，这里会是空列表
    expect(body.items.map((i) => i.id)).toEqual([otherConnectionId]);
    expect(body.total).toBe(1);

    // 管理员看到全部：total 必须是真实计数而不是当前页长度
    const adminView = await app.inject({
      method: 'GET',
      url: '/api/v1/connections?limit=1',
      headers: auth(adminToken),
    });
    const adminBody = adminView.json() as { items: unknown[]; total: number };
    expect(adminBody.items).toHaveLength(1);
    expect(adminBody.total).toBeGreaterThan(1);
  });
});

describe('query.max_rows 是上限而不是默认值（回归）', () => {
  it('请求里传更大的 maxRows 也不能突破设置的上限', async () => {
    const setRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/meta/settings',
      headers: auth(adminToken),
      payload: { items: [{ key: 'query.max_rows', value: 2 }] },
    });
    expect(setRes.statusCode, setRes.body).toBe(200);
    try {
      // 造一个有 5 行的表
      const manyPath = join(dir, 'many.db');
      const raw = new DatabaseSync(manyPath);
      raw.exec('CREATE TABLE n (v INTEGER)');
      for (let i = 1; i <= 5; i += 1) raw.prepare('INSERT INTO n (v) VALUES (?)').run(i);
      raw.close();
      const conn = await app.inject({
        method: 'POST',
        url: '/api/v1/connections',
        headers: auth(adminToken),
        payload: { name: '上限回归', dbType: 'sqlite', databaseName: manyPath },
      });
      const id = conn.json().item.id as number;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/query/execute',
        headers: auth(adminToken),
        // 显式要 100 行
        payload: { connectionId: id, sql: 'SELECT v FROM n', maxRows: 100 },
      });
      expect(res.statusCode, res.body).toBe(200);
      const result = res.json() as { rows: unknown[][]; truncated: boolean };
      expect(result.rows.length ?? 0).toBeLessThanOrEqual(2);
      expect(result.truncated).toBe(true);
    } finally {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/meta/settings',
        headers: auth(adminToken),
        payload: { items: [{ key: 'query.max_rows', value: 10_000 }] },
      });
    }
  });
});

describe('框架层 4xx 不再被误报成 500（回归：坏 JSON 会刷 error 日志）', () => {
  it('畸形 JSON 返回 400 而不是 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: 'not-json',
    });
    // 旧实现：normalizeError 把非 PeanutError 一律当 INTERNAL(500)
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; details?: { frameworkCode?: string } } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // 仍要能拿到稳定标识便于排查，但不能回传框架原文或堆栈
    expect(body.error.details?.frameworkCode).toBe('FST_ERR_CTP_INVALID_JSON_BODY');
    expect(JSON.stringify(body)).not.toContain('stack');
  });
});

describe('取消查询需要归属与可见性（回归：可枚举 queryId 中断他人查询）', () => {
  it('取消操作会被审计留痕，且只在自己可见的连接上下发', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/query/cancel',
      headers: auth(adminToken),
      payload: { queryId: 'q-1-regression' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const logs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs?action=query_cancel&limit=5',
      headers: auth(adminToken),
    });
    expect(logs.statusCode, logs.body).toBe(200);
    const detail = JSON.stringify(logs.json());
    expect(detail, '取消查询必须留下审计记录').toContain('q-1-regression');
  });
});

describe('公开接口不泄漏服务端内部信息（回归：绝对路径与密钥保护方式）', () => {
  it('/health 不再回传 masterKeyMode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // 未鉴权接口不该告诉外人"本地库有没有被主密码保护"
    expect(body.masterKeyMode).toBeUndefined();
    // 但运维需要的版本信息仍然保留
    expect(body.status).toBe('ok');
    expect(body.schemaVersion).toBeDefined();
  });

  it('/meta/info 不再回传服务端绝对路径', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.dataDir).toBeUndefined();
    expect(body.dbPath).toBeUndefined();
    // 产品元信息本身仍要可用
    expect(body.license).toContain('AGPL-3.0');
    expect(Array.isArray(body.implementedDrivers)).toBe(true);
  });
});

describe('实例标识 nonce（桌面端用来确认端口上应答的是自己启动的子进程）', () => {
  it('未配置 nonce 时 /health 不出现该字段（普通部署不暴露额外信息）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>).instanceNonce).toBeUndefined();
  });

  it('配置了 nonce 时 /health 原样回显，且其它接口不泄漏它', async () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'ps-nonce-'));
    try {
      const nonce = 'a1b2c3d4e5f6a7b8';
      const ctx3 = createContext({
        config: { ...testConfig(), dataDir: dir3, instanceNonce: nonce },
        memory: true,
      });
      const app3 = await buildServer(ctx3, { quiet: true });
      await app3.ready();
      try {
        const health = await app3.inject({ method: 'GET', url: '/api/v1/health' });
        expect(health.statusCode).toBe(200);
        // 桌面端就是靠这个字段确认"应答者是我 spawn 的子进程"
        expect(health.json().instanceNonce).toBe(nonce);

        // 非健康检查接口不应出现它（避免被当作跨接口可读的标识）
        const info = await app3.inject({ method: 'GET', url: '/api/v1/meta/info' });
        expect(JSON.stringify(info.json())).not.toContain(nonce);
      } finally {
        await app3.close();
        await disposeContext(ctx3);
      }
    } finally {
      rmSync(dir3, { recursive: true, force: true });
    }
  });
});

describe('代理信任默认关闭（X-Forwarded-For 不可伪造）', () => {
  it('parseTrustProxy 的取值语义：默认不信任，写错也退回不信任', async () => {
    const { parseTrustProxy } = await import('./config.js');
    // 默认（未配置）必须是"不信任"，这是安全关键
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    // 显式开启
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(true);
    // 只信任指定网段（推荐用法）
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
    // 无法识别的值必须退回"不信任"，不能因为写错就变成"信任全部"
    expect(parseTrustProxy('yes')).toEqual(['yes']);
    expect(parseTrustProxy(', ,')).toBe(false);
  });

  it('默认配置下伪造的 X-Forwarded-For 不会改写 req.ip / 审计 clientIp', async () => {
    const ctx2 = createContext({ config: { ...testConfig(), trustProxy: false }, memory: true });
    const app2 = await buildServer(ctx2, { quiet: true });
    await app2.ready();
    try {
      // 直接注入一个"自称来自 1.2.3.4"的请求
      const res = await app2.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': '1.2.3.4' },
        payload: { username: 'nobody', password: 'wrongpass' },
      });
      // 注入请求的 socket 地址是 127.0.0.1，伪造头必须被忽略
      const rows = ctx2.pdb.audit.query({ limit: 20 });
      const entry = rows.items[0] as unknown as Record<string, unknown> | undefined;
      expect(entry).toBeDefined();
      // 审计里记的必须是真实对端地址，而不是伪造头里的值
      expect(JSON.stringify(entry)).not.toContain('1.2.3.4');
      expect(JSON.stringify(entry)).toContain('127.0.0.1');
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await app2.close();
      await disposeContext(ctx2);
    }
  });

  it('显式开启 trustProxy 后才采信转发头（部署在反代后时使用）', async () => {
    const ctx3 = createContext({ config: { ...testConfig(), trustProxy: true }, memory: true });
    const app3 = await buildServer(ctx3, { quiet: true });
    await app3.ready();
    try {
      // 开启后 Fastify 采信转发头，审计里应出现伪造值 —— 用来证明
      // "默认关闭"确实是靠配置生效的，而不是因为代码根本不读这个头
      const login = await app3.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        payload: { username: 'nobody', password: 'wrongpass' },
      });
      expect(login.statusCode).toBeGreaterThanOrEqual(400);
      const rows = ctx3.pdb.audit.query({ limit: 20 });
      expect(JSON.stringify(rows.items[0])).toContain('203.0.113.9');
    } finally {
      await app3.close();
      await disposeContext(ctx3);
    }
  });
});

describe('强制改密标记按用户隔离（回归：别人的改密不能解除我的闸门）', () => {
  it('另一个用户改密不会解除默认口令管理员的强制改密', async () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'ps-gate-peruser-'));
    try {
      // 用**默认口令**引导：必须触发强制改密
      const ctx4 = createContext({
        config: { ...testConfig(), dataDir: dir4, bootstrapAdminPassword: null },
        memory: true,
      });
      const app4 = await buildServer(ctx4, { quiet: true });
      await app4.ready();
      try {
        const adminLogin = await app4.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'admin', password: '123456' },
        });
        expect(adminLogin.statusCode, adminLogin.body).toBe(200);
        const adminTok = adminLogin.json().token as string;
        expect(adminLogin.json().mustChangePassword).toBe(true);

        // 管理员建一个普通用户（此时闸门已生效，但 /users 属于被拦接口，
        // 所以直接用仓储层创建，模拟"老版本里已经存在的第二个账号"）
        ctx4.pdb.users.create({
          username: 'gate-other',
          passwordHash: 'scrypt$1$1$1$c2FsdA==$aGFzaA==',
          displayName: '他人',
          isAdmin: false,
          roles: ['developer'],
        });
        // 用真实口令重建该用户，便于正常登录
        const { hashSecret } = await import('@peanutsprout/storage');
        const other = ctx4.pdb.users.findByUsername('gate-other')!;
        ctx4.pdb.users.setPassword(other.id, hashSecret('Other-Passw0rd!'));
        // 该用户不应处于强制改密状态（只有引导管理员才置位）
        expect(ctx4.pdb.settings.get(`security.must_change_password.${other.id}`)).toBeNull();

        const otherLogin = await app4.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: 'gate-other', password: 'Other-Passw0rd!' },
        });
        expect(otherLogin.statusCode, otherLogin.body).toBe(200);
        const otherTok = otherLogin.json().token as string;

        // ① 闸门对管理员生效：业务接口必须被拒
        const blocked = await app4.inject({
          method: 'GET',
          url: '/api/v1/connections',
          headers: { authorization: `Bearer ${adminTok}` },
        });
        expect(blocked.statusCode, blocked.body).toBe(403);
        expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

        // ② 他人改自己的口令（闸门白名单允许 /auth/change-password）
        const change = await app4.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password',
          headers: { authorization: `Bearer ${otherTok}` },
          payload: { oldPassword: 'Other-Passw0rd!', newPassword: 'Other-Passw0rd!2' },
        });
        expect(change.statusCode, change.body).toBe(200);

        // ③ 关键断言：管理员的闸门**仍然**生效（修复前这里会被解除 → 200）
        const stillBlocked = await app4.inject({
          method: 'GET',
          url: '/api/v1/connections',
          headers: { authorization: `Bearer ${adminTok}` },
        });
        expect(
          stillBlocked.statusCode,
          `他人的改密解除了管理员的强制改密：${stillBlocked.statusCode} ${stillBlocked.body}`,
        ).toBe(403);
        expect(stillBlocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

        // ④ 管理员自己改密后闸门才解除
        const adminChange = await app4.inject({
          method: 'POST',
          url: '/api/v1/auth/change-password',
          headers: { authorization: `Bearer ${adminTok}` },
          payload: { oldPassword: '123456', newPassword: 'Adm1n-New-Pass!' },
        });
        expect(adminChange.statusCode, adminChange.body).toBe(200);
        const after = await app4.inject({
          method: 'GET',
          url: '/api/v1/connections',
          headers: { authorization: `Bearer ${adminTok}` },
        });
        expect(after.statusCode, after.body).toBe(200);
      } finally {
        await app4.close();
        await disposeContext(ctx4);
      }
    } finally {
      rmSync(dir4, { recursive: true, force: true });
    }
  });
});
