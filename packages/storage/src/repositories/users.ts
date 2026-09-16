/**
 * 花生苗数据库管理工具 - 用户 / 角色 / 权限 / 资源授权 仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  PeanutError,
  notFound,
  type ResourceGrant,
  type User,
  type UserDTO,
} from '@peanutsprout/core';
import { nowIso, toIso, type LocalDatabase } from '../database.js';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  status: number;
  is_admin: number;
  totp_secret: string | null;
  totp_enabled: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

/** 允许被更新的用户列（白名单，杜绝动态列名注入）。 */
const UPDATABLE_COLUMNS = {
  displayName: 'display_name',
  email: 'email',
  phone: 'phone',
  status: 'status',
  isAdmin: 'is_admin',
  passwordHash: 'password_hash',
  totpSecret: 'totp_secret',
  totpEnabled: 'totp_enabled',
} as const;

export type UserPatch = Partial<{
  displayName: string | null;
  email: string | null;
  phone: string | null;
  status: number;
  isAdmin: boolean;
  passwordHash: string;
  totpSecret: string | null;
  totpEnabled: boolean;
}>;

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  isAdmin?: boolean;
  roles?: string[];
}

export interface LoginFailurePolicy {
  maxAttempts: number;
  lockMinutes: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    status: Number(row.status),
    isAdmin: Number(row.is_admin) === 1,
    totpEnabled: Number(row.totp_enabled) === 1,
    lastLoginAt: toIso(row.last_login_at),
    lastLoginIp: row.last_login_ip,
    failedAttempts: Number(row.failed_attempts),
    lockedUntil: toIso(row.locked_until),
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

export class UserRepository {
  constructor(private readonly db: LocalDatabase) {}

  count(): number {
    return this.db.count('SELECT COUNT(*) AS c FROM users');
  }

  countAdmins(): number {
    return this.db.count('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status = 1');
  }

  create(input: CreateUserInput): User {
    const username = input.username?.trim();
    if (!username) throw new PeanutError('VALIDATION_FAILED', '用户名不能为空');
    if (!/^[A-Za-z0-9._@-]{2,64}$/.test(username)) {
      throw new PeanutError('VALIDATION_FAILED', '用户名只能包含字母、数字、点、下划线、@ 和连字符，长度 2-64');
    }
    if (this.findByUsername(username)) {
      throw new PeanutError('CONFLICT', `用户名已存在: ${username}`);
    }
    // 用户行与角色必须在**同一个事务**里写入。
    // 之前 setRoles() 被放在事务外，导致传入不存在的角色时：用户行已提交、
    // 角色写入抛错，接口返回失败，却留下一个"没有角色但仍能登录"的账号
    // （已实测复现）。现在内层 setRoles 走 SAVEPOINT，失败会连带回滚用户行。
    const id = this.db.transaction(() => {
      const r = this.db.run(
        `INSERT INTO users (username, password_hash, display_name, email, phone, is_admin)
         VALUES (?, ?, ?, ?, ?, ?)`,
        username,
        input.passwordHash,
        input.displayName ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.isAdmin ? 1 : 0,
      );
      const newId = Number(r.lastInsertRowid);
      if (input.roles && input.roles.length > 0) this.setRoles(newId, input.roles);
      return newId;
    });
    return this.findById(id) as User;
  }

  findById(id: number): User | null {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return row ? toUser(row) : null;
  }

  findByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    if (!row) return null;
    return { ...toUser(row), passwordHash: row.password_hash };
  }

  /** 按用户名或邮箱查找，供登录与找回密码使用。 */
  findByLogin(login: string): (User & { passwordHash: string }) | null {
    const row = this.db.get<UserRow>(
      'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?) LIMIT 1',
      login,
      login,
    );
    if (!row) return null;
    return { ...toUser(row), passwordHash: row.password_hash };
  }

  list(): User[] {
    return this.db.all<UserRow>('SELECT * FROM users ORDER BY id ASC').map(toUser);
  }

  update(id: number, patch: UserPatch): User {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      if (!(key in patch)) continue;
      const value = (patch as Record<string, unknown>)[key];
      sets.push(`${column} = ?`);
      params.push(
        typeof value === 'boolean' ? (value ? 1 : 0) : ((value as string | number | null) ?? null),
      );
    }
    if (sets.length === 0) {
      const existing = this.findById(id);
      if (!existing) throw notFound('用户', id);
      return existing;
    }
    // 最后一个管理员不允许被降权或禁用，避免把自己锁在系统外
    if (patch.isAdmin === false || patch.status === 0) {
      const target = this.findById(id);
      if (!target) throw notFound('用户', id);
      if (target.isAdmin && this.countAdmins() <= 1) {
        throw new PeanutError('CONFLICT', '系统必须保留至少一个启用的管理员账号');
      }
    }
    const res = this.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
    if (res.changes === 0) throw notFound('用户', id);
    return this.findById(id) as User;
  }

  setPassword(id: number, passwordHash: string): void {
    const res = this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, id);
    if (res.changes === 0) throw notFound('用户', id);
  }

  getPasswordHash(id: number): string | null {
    const row = this.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', id);
    return row?.password_hash ?? null;
  }

  delete(id: number): boolean {
    const target = this.findById(id);
    if (!target) return false;
    if (target.isAdmin && this.countAdmins() <= 1) {
      throw new PeanutError('CONFLICT', '系统必须保留至少一个启用的管理员账号');
    }
    return this.db.run('DELETE FROM users WHERE id = ?', id).changes > 0;
  }

  recordLoginSuccess(id: number, ip: string | null): void {
    this.db.run(
      `UPDATE users SET last_login_at = ?, last_login_ip = ?, failed_attempts = 0, locked_until = NULL
       WHERE id = ?`,
      nowIso(),
      ip,
      id,
    );
  }

  recordLoginFailure(id: number, policy: LoginFailurePolicy): { attempts: number; locked: boolean } {
    const row = this.db.get<{ failed_attempts: number }>(
      'SELECT failed_attempts FROM users WHERE id = ?',
      id,
    );
    const attempts = Number(row?.failed_attempts ?? 0) + 1;
    const locked = attempts >= policy.maxAttempts;
    const lockedUntil = locked ? new Date(Date.now() + policy.lockMinutes * 60_000).toISOString() : null;
    this.db.run(
      'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
      attempts,
      lockedUntil,
      id,
    );
    return { attempts, locked };
  }

  unlock(id: number): void {
    this.db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', id);
  }

  // ------------------------------------------------------------ 角色与权限

  rolesOf(userId: number): string[] {
    return this.db
      .all<{ name: string }>(
        `SELECT r.name FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = ? ORDER BY r.name`,
        userId,
      )
      .map((r) => r.name);
  }

  setRoles(userId: number, roleNames: string[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM user_roles WHERE user_id = ?', userId);
      for (const name of roleNames) {
        const role = this.db.get<{ id: number }>('SELECT id FROM roles WHERE name = ?', name);
        if (!role) throw new PeanutError('VALIDATION_FAILED', `角色不存在: ${name}`);
        this.db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', userId, role.id);
      }
    });
  }

  /** 用户的有效权限码集合（角色权限 ∪ 资源级授权隐含的操作）。 */
  permissionsOf(userId: number): string[] {
    const rows = this.db.all<{ code: string }>(
      `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?
       ORDER BY p.code`,
      userId,
    );
    return rows.map((r) => r.code);
  }

  listRoles(): Array<{ id: number; name: string; description: string | null; isBuiltin: boolean }> {
    return this.db
      .all<{ id: number; name: string; description: string | null; is_builtin: number }>(
        'SELECT * FROM roles ORDER BY id',
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isBuiltin: Number(r.is_builtin) === 1,
      }));
  }

  listPermissions(): Array<{ id: number; code: string; name: string; category: string | null }> {
    return this.db
      .all<{ id: number; code: string; name: string; category: string | null }>(
        'SELECT id, code, name, category FROM permissions ORDER BY category, code',
      );
  }

  // ------------------------------------------------------------ 资源级授权

  grantsOf(userId: number): ResourceGrant[] {
    return this.db
      .all<{
        id: number;
        user_id: number;
        resource_type: 'connection' | 'schema' | 'table';
        resource_id: string;
        actions: string;
        created_at: string;
      }>('SELECT * FROM resource_grants WHERE user_id = ? ORDER BY id', userId)
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        actions: safeParseArray(r.actions),
        createdAt: toIso(r.created_at) ?? '',
      }));
  }

  setGrants(
    userId: number,
    grants: Array<{ resourceType: 'connection' | 'schema' | 'table'; resourceId: string; actions: string[] }>,
  ): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM resource_grants WHERE user_id = ?', userId);
      for (const g of grants) {
        this.db.run(
          'INSERT INTO resource_grants (user_id, resource_type, resource_id, actions) VALUES (?, ?, ?, ?)',
          userId,
          g.resourceType,
          g.resourceId,
          JSON.stringify(g.actions),
        );
      }
    });
  }

  toDTO(user: User): UserDTO {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      status: user.status,
      isAdmin: user.isAdmin,
      roles: this.rolesOf(user.id),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}

function safeParseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
