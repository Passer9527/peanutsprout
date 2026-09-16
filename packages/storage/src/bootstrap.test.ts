/**
 * 花生苗数据库管理工具 - 首次引导管理员测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 需求方明确要求「默认用户名 admin、默认密码 123456」。
 * 这里把这个约定钉死：默认值一旦被改回去，测试必须失败，
 * 因为 README 与首启提示都依赖它。
 */

import { describe, expect, it } from 'vitest';
import { verifySecret } from './crypto.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  ensureAdminUser,
  openPeanutDatabase,
} from './index.js';

function memoryDb() {
  return openPeanutDatabase({ dataDir: '/tmp/ps-bootstrap-test', memory: true });
}

describe('首次引导管理员', () => {
  it('默认用户名与口令就是 admin / 123456', () => {
    expect(DEFAULT_ADMIN_USERNAME).toBe('admin');
    expect(DEFAULT_ADMIN_PASSWORD).toBe('123456');
  });

  it('首次引导创建 admin，且 123456 能通过口令校验', () => {
    const db = memoryDb();
    const result = ensureAdminUser(db);
    expect(result.created).toBe(true);
    expect(result.username).toBe('admin');
    expect(result.initialPassword).toBe('123456');

    const user = db.users.findByUsername('admin');
    expect(user).not.toBeNull();
    expect(user!.isAdmin).toBe(true);
    // 关键：库里存的是哈希，必须能用 123456 验通过（而不是只比较字符串）
    expect(verifySecret('123456', user!.passwordHash)).toBe(true);
    expect(verifySecret('wrong-password', user!.passwordHash)).toBe(false);
    db.close();
  });

  it('引导后强制首次登录改密', () => {
    const db = memoryDb();
    ensureAdminUser(db);
    expect(db.settings.get('security.must_change_password')).toBe('true');
    db.close();
  });

  it('可以用环境变量覆盖默认口令（部署方据此恢复强口令）', () => {
    const db = memoryDb();
    const result = ensureAdminUser(db, { password: 'Str0ng-Passw0rd!' });
    expect(result.initialPassword).toBe('Str0ng-Passw0rd!');
    const user = db.users.findByUsername('admin');
    expect(verifySecret('Str0ng-Passw0rd!', user!.passwordHash)).toBe(true);
    expect(verifySecret('123456', user!.passwordHash)).toBe(false);
    db.close();
  });

  it('已存在用户时不覆盖（避免重置生产库账号）', () => {
    const db = memoryDb();
    ensureAdminUser(db);
    const again = ensureAdminUser(db, { password: 'should-not-apply' });
    expect(again.created).toBe(false);
    expect(again.initialPassword).toBeNull();
    const user = db.users.findByUsername('admin');
    expect(verifySecret('123456', user!.passwordHash)).toBe(true);
    db.close();
  });
});

/**
 * 回归测试：失败的用户创建不能留下"半成品账号"。
 *
 * 曾经的实现把 setRoles() 放在创建用户的事务**外面**，因此传入不存在的角色时
 * 会先提交 users 行、再抛"角色不存在"，接口返回失败——但库里已经多了一个
 * 没有任何角色、却能正常登录的账号。这类孤儿账号是纯粹的权限盲区。
 */
describe('用户创建失败时必须整体回滚', () => {
  it('角色不存在时，不留下任何用户行', () => {
    const db = memoryDb();
    const before = db.users.count();
    expect(() =>
      db.users.create({
        username: 'orphan',
        passwordHash: 'x',
        displayName: null,
        email: null,
        phone: null,
        isAdmin: false,
        roles: ['no-such-role'],
      }),
    ).toThrow(/角色不存在/);
    // 关键断言：总数没变，且按用户名查不到
    expect(db.users.count()).toBe(before);
    expect(db.users.findByUsername('orphan')).toBeNull();
    db.close();
  });

  it('合法角色仍然写入成功（嵌套事务没有破坏正常路径）', () => {
    const db = memoryDb();
    const created = db.users.create({
      username: 'okuser',
      passwordHash: 'x',
      displayName: null,
      email: null,
      phone: null,
      isAdmin: false,
      roles: ['readonly'],
    });
    expect(db.users.findByUsername('okuser')).not.toBeNull();
    expect(db.users.listRoles().some((r) => r.name === 'readonly')).toBe(true);
    // 注意：toUser() 不含 roles，角色要单独取
    expect(db.users.rolesOf(created.id)).toEqual(['readonly']);
    db.close();
  });

  it('事务嵌套：内层已提交的内容会随外层失败一起回滚', () => {
    const db = memoryDb();
    expect(() =>
      // PeanutDatabase.db 才是底层 LocalDatabase
      db.db.transaction(() => {
        db.db.run('INSERT INTO settings (key, value, category) VALUES (?, ?, ?)', 'tx.probe', '1', 'test');
        // 内层事务（正常路径）
        db.db.transaction(() => {
          db.db.run('INSERT INTO settings (key, value, category) VALUES (?, ?, ?)', 'tx.inner', '1', 'test');
        });
        throw new Error('外层失败');
      }),
    ).toThrow(/外层失败/);
    // get() 在无行时返回 undefined（不是 null）
    expect(db.db.get("SELECT value FROM settings WHERE key = 'tx.probe'")).toBeUndefined();
    expect(db.db.get("SELECT value FROM settings WHERE key = 'tx.inner'")).toBeUndefined();
    db.close();
  });
});

/**
 * 回归测试：审计日志必须是**不可变**的。
 *
 * 原 DDL 在 audit_logs.user_id 上加了 `ON DELETE SET NULL` 外键，而 user_id 参与
 * 哈希链计算。于是「删除一个用户」会把该用户的所有历史审计行 user_id 改写成 NULL，
 * 让链校验**永久失败** —— 与产品"哈希链可校验、可检测篡改"的承诺直接冲突。
 * 这个测试用"删用户后链是否仍然完整"把该约束钉死。
 */
describe('审计日志不可变（哈希链完整性）', () => {
  it('删除用户后，该用户的审计行不被改写，链校验仍然通过', () => {
    const db = memoryDb();
    const u = db.users.create({
      username: 'audit-victim',
      passwordHash: 'x',
      displayName: null,
      email: null,
      phone: null,
      isAdmin: false,
      roles: ['readonly'],
    });
    db.audit.append({
      userId: u.id,
      username: 'audit-victim',
      action: 'login',
      resourceType: 'session',
      resourceId: 'sid-1',
      status: 'success',
    });
    expect(db.audit.verifyChain().ok).toBe(true);
    const userIdBefore = db.db.get<{ user_id: number }>(
      'SELECT user_id FROM audit_logs ORDER BY id DESC LIMIT 1',
    )?.user_id;
    expect(userIdBefore).toBe(u.id);

    expect(db.users.delete(u.id)).toBe(true);

    // 关键：审计行的 user_id 不能被清空
    const userIdAfter = db.db.get<{ user_id: number }>(
      'SELECT user_id FROM audit_logs ORDER BY id DESC LIMIT 1',
    )?.user_id;
    expect(userIdAfter).toBe(u.id);
    // 关键：链必须仍然完整
    expect(db.audit.verifyChain()).toMatchObject({ ok: true });
    db.close();
  });

  it('audit_logs 上不存在指向 users 的外键', () => {
    const db = memoryDb();
    const fks = db.db.all<{ table: string; from: string; to: string }>(
      'PRAGMA foreign_key_list(audit_logs)',
    );
    expect(fks.filter((f) => f.table === 'users')).toEqual([]);
    db.close();
  });
});
