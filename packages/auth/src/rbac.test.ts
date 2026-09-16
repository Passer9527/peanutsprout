/**
 * 花生苗数据库管理工具 - RBAC 权限模型测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 权限判定是安全边界，测试重点：
 *  - 连接可见性的两种模式（全量 / 白名单）
 *  - 只读保护的优先级（连接只读 > 角色权限）
 *  - 生产库 AI 写闸门默认拒绝
 */

import { PeanutError, PRODUCTION_COLOR_TAGS, type AuthContext, type User } from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import {
  assertAiWriteAllowed,
  assertCanWrite,
  assertConnectionVisible,
  canSeeConnection,
  canWriteConnection,
  hasPermission,
  isProductionConnection,
  resolveConnectionScope,
} from './rbac.js';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'u',
    displayName: null,
    email: null,
    phone: null,
    isAdmin: false,
    status: 1,
    totpEnabled: false,
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    lastLoginIp: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ctx(options: {
  permissions?: string[];
  isAdmin?: boolean;
  grants?: Record<string, string[]>;
}): AuthContext {
  return {
    user: user({ isAdmin: options.isAdmin ?? false }),
    roles: [],
    permissions: options.permissions ?? [],
    grants: new Map(Object.entries(options.grants ?? {})),
    sessionId: 's',
  };
}

describe('hasPermission', () => {
  it('管理员拥有全部权限', () => {
    const admin = ctx({ isAdmin: true, permissions: [] });
    expect(hasPermission(admin, 'anything.at.all')).toBe(true);
  });

  it('普通用户按权限码判定', () => {
    const developer = ctx({ permissions: ['query.read', 'query.write'] });
    expect(hasPermission(developer, 'query.read')).toBe(true);
    expect(hasPermission(developer, 'query.write')).toBe(true);
    expect(hasPermission(developer, 'user.manage')).toBe(false);
  });

  it('通配权限 * 覆盖一切', () => {
    expect(hasPermission(ctx({ permissions: ['*'] }), 'user.manage')).toBe(true);
  });
});

describe('连接可见范围', () => {
  it('没有任何连接授权时退化为"角色模式"，可见全部连接', () => {
    const scope = resolveConnectionScope(ctx({ permissions: ['query.read'] }));
    expect(scope.mode).toBe('all');
  });

  it('存在连接授权时进入"白名单模式"', () => {
    const scope = resolveConnectionScope(
      ctx({ permissions: ['query.read'], grants: { 'connection:7': ['read'] } }),
    );
    // 显式收窄：ConnectionScope 是可辨识联合，先断言 mode 再取 ids
    if (scope.mode !== 'list') throw new Error(`期望白名单模式，实际为 ${scope.mode}`);
    expect(scope.mode).toBe('list');
    expect(scope.ids).toEqual([7]);
    expect(canSeeConnection(ctx({ permissions: ['query.read'], grants: { 'connection:7': ['read'] } }), 7)).toBe(
      true,
    );
    expect(canSeeConnection(ctx({ permissions: ['query.read'], grants: { 'connection:7': ['read'] } }), 8)).toBe(
      false,
    );
  });

  it('管理员始终可见全部连接（即使配了白名单）', () => {
    const admin = ctx({ isAdmin: true, grants: { 'connection:7': ['read'] } });
    expect(resolveConnectionScope(admin).mode).toBe('all');
    expect(canSeeConnection(admin, 999)).toBe(true);
  });

  it('不可见时报 NOT_FOUND，且与"连接不存在"完全无法区分', () => {
    // 这里刻意不用 AUTH_FORBIDDEN：403 会让攻击者用状态码差异判断某个 id
    // 是否存在，从而枚举出系统里的全部连接。返回 404 才能让"无权访问"
    // 与"不存在"在外部观察上等价，符合验收标准 AC-05 的可见性要求。
    const c = ctx({ permissions: ['query.read'], grants: { 'connection:7': ['read'] } });
    expect(() => assertConnectionVisible(c, 8)).toThrow(PeanutError);
    try {
      assertConnectionVisible(c, 8);
    } catch (e) {
      expect((e as PeanutError).code).toBe('NOT_FOUND');
    }
  });
});

describe('连接写权限', () => {
  const READ_ONLY_CONN = { readOnly: true };
  const WRITABLE_CONN = { readOnly: false };

  it('没有 query.write 权限时一律不能写', () => {
    expect(canWriteConnection(ctx({ permissions: ['query.read'] }), 1, WRITABLE_CONN)).toBe(false);
  });

  it('连接开启只读保护后即使用户有写权限也不能写', () => {
    const c = ctx({ permissions: ['query.read', 'query.write'] });
    expect(canWriteConnection(c, 1, READ_ONLY_CONN)).toBe(false);
    expect(() => assertCanWrite(c, 1, READ_ONLY_CONN)).toThrow(/只读/);
  });

  it('isReadOnly 与 readOnly 两种字段都能识别只读', () => {
    const c = ctx({ permissions: ['query.write'] });
    expect(canWriteConnection(c, 1, { isReadOnly: true })).toBe(false);
    expect(canWriteConnection(c, 1, { readOnly: true })).toBe(false);
    expect(canWriteConnection(c, 1, { readOnly: false, isReadOnly: false })).toBe(true);
  });

  it('白名单模式下需要显式 write 授权', () => {
    const readOnlyGrant = ctx({ permissions: ['query.write'], grants: { 'connection:5': ['read'] } });
    expect(canWriteConnection(readOnlyGrant, 5, WRITABLE_CONN)).toBe(false);

    const writeGrant = ctx({ permissions: ['query.write'], grants: { 'connection:5': ['write'] } });
    expect(canWriteConnection(writeGrant, 5, WRITABLE_CONN)).toBe(true);

    const starGrant = ctx({ permissions: ['query.write'], grants: { 'connection:5': ['*'] } });
    expect(canWriteConnection(starGrant, 5, WRITABLE_CONN)).toBe(true);
  });

  it('只读账号报错信息明确指向账号而非连接', () => {
    const readonly = ctx({ permissions: ['query.read'] });
    try {
      assertCanWrite(readonly, 1, WRITABLE_CONN);
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as PeanutError).code).toBe('AUTH_FORBIDDEN');
      expect((e as PeanutError).message).toContain('只读账号');
    }
  });
});

describe('生产库识别与 AI 写闸门', () => {
  it('只读连接视为生产库', () => {
    expect(isProductionConnection({ readOnly: true })).toBe(true);
  });

  it('按名称/颜色标记识别生产库', () => {
    expect(isProductionConnection({ name: '生产库主节点' })).toBe(true);
    expect(isProductionConnection({ name: 'prod-mysql' })).toBe(true);
    // 历史符号值（旧版本 / CLI 写入）仍需兼容
    expect(isProductionConnection({ colorTag: 'red' })).toBe(true);
    // 关键：用 Web 颜色选择器**真实写入的红色**（apps/web COLOR_TAGS 里的 #d1524a）。
    // 旧用例写的是 'green' 之类的符号值，界面上根本不会产生，才让
    // "界面标红生产库却识别不到"的缺陷长期逃过测试。
    expect(isProductionConnection({ colorTag: '#d1524a' })).toBe(true);
    expect(isProductionConnection({ colorTag: '#D1524A' })).toBe(true);
    expect(isProductionConnection({ name: '本地测试库', colorTag: '#3f9c5a' })).toBe(false);
  });

  it('生产色标集合包含 Web 端红色常量（契约不能漂移）', () => {
    // 与 apps/web/src/utils/connectionColors.test.ts 的交叉断言配合：
    // 界面换主色或这里被删值，都会至少有一处测试变红。
    expect(PRODUCTION_COLOR_TAGS).toContain('#d1524a');
  });

  it('生产库上 AI 写操作默认要求人工确认', () => {
    const developer = ctx({ permissions: ['ai.use', 'query.write'] });
    try {
      assertAiWriteAllowed(developer, { name: '生产库' }, { productionWriteAllowed: false, aiEnabled: true });
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as PeanutError).code).toBe('CONFIRMATION_REQUIRED');
    }
  });

  it('显式放开后允许（管理员知情选择）', () => {
    const developer = ctx({ permissions: ['ai.use', 'query.write'] });
    expect(() =>
      assertAiWriteAllowed(developer, { name: '生产库' }, { productionWriteAllowed: true, aiEnabled: true }),
    ).not.toThrow();
  });

  it('AI 全局关闭时即使放开生产库也拒绝', () => {
    const developer = ctx({ permissions: ['ai.use'] });
    try {
      assertAiWriteAllowed(developer, null, { productionWriteAllowed: true, aiEnabled: false });
      throw new Error('应当抛错');
    } catch (e) {
      expect((e as PeanutError).code).toBe('AI_DISABLED');
    }
  });

  it('无 ai.use 权限时拒绝', () => {
    const plain = ctx({ permissions: ['query.read'] });
    expect(() =>
      assertAiWriteAllowed(plain, null, { productionWriteAllowed: true, aiEnabled: true }),
    ).toThrow(/AI 使用权限/);
  });
});

/**
 * 回归：只给 schema/table 级授权时，绝不能放大成"全部连接可见/可写"。
 *
 * 旧实现判断白名单模式看的是"有没有 connection 级授权"，于是
 * 「一条 table 授权」= connection 级授权数为 0 = 退回 all 模式，
 * 该用户反而能看见并写系统里的每一个连接 —— 授权越少权限越大。
 */
describe('连接可见范围 · schema/table 级授权不得放大为全部可见（回归）', () => {
  const onlyTableGrant = ctx({ permissions: ['query.read', 'query.write'], grants: { 'table:12': ['read'] } });
  const onlySchemaGrant = ctx({ permissions: ['query.read'], grants: { 'schema:3': ['read'] } });

  it('只有 table 级授权时不返回 all 模式', () => {
    const scope = resolveConnectionScope(onlyTableGrant);
    if (scope.mode !== 'list') throw new Error(`期望白名单模式，实际为 ${scope.mode}`);
    expect(scope.ids).toEqual([]);
  });

  it('只有 table 级授权时看不到任何连接', () => {
    expect(canSeeConnection(onlyTableGrant, 1)).toBe(false);
    expect(canSeeConnection(onlyTableGrant, 999)).toBe(false);
  });

  it('只有 schema 级授权时同样看不到任何连接', () => {
    expect(canSeeConnection(onlySchemaGrant, 1)).toBe(false);
  });

  it('只有 table 级授权时也不能写任何连接', () => {
    expect(canWriteConnection(onlyTableGrant, 1)).toBe(false);
  });

  it('确实没有任何授权记录时才退回角色模式（既有行为不变）', () => {
    const noGrants = ctx({ permissions: ['query.read'] });
    expect(resolveConnectionScope(noGrants).mode).toBe('all');
    expect(canSeeConnection(noGrants, 123)).toBe(true);
  });

  it('连接级授权与 table 授权混用时，可见范围仍只由连接级授权决定', () => {
    const mixed = ctx({
      permissions: ['query.read'],
      grants: { 'connection:5': ['read'], 'table:12': ['read'] },
    });
    const scope = resolveConnectionScope(mixed);
    if (scope.mode !== 'list') throw new Error(`期望白名单模式，实际为 ${scope.mode}`);
    expect(scope.ids).toEqual([5]);
    expect(canSeeConnection(mixed, 5)).toBe(true);
    expect(canSeeConnection(mixed, 12)).toBe(false);
  });
});
