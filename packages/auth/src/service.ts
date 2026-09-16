/**
 * 花生苗数据库管理工具 - 认证服务
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖 PRD 4.6：登录、登出、改密、账号锁定、会话吊销、资源授权上下文构建。
 * 所有成功与失败的登录都会写审计日志（失败也记，便于发现撞库）。
 */

import {
  PeanutError,
  type AuthContext,
  type User,
  type UserDTO,
} from '@peanutsprout/core';
import {
  checkPasswordStrength,
  hashSecret,
  newId,
  sha256Hex,
  verifySecret,
  writeMustChangePassword,
  type PeanutDatabase,
} from '@peanutsprout/storage';
import { deriveJwtSecret, signToken, verifyToken } from './tokens.js';

export interface AuthServiceOptions {
  /** 令牌有效期（秒），默认 12 小时 */
  tokenTtlSec?: number;
  maxFailedAttempts?: number;
  lockMinutes?: number;
}

export interface LoginInput {
  username: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  token: string;
  expiresIn: number;
  sessionId: string;
  user: UserDTO;
  roles: string[];
  permissions: string[];
}

const DEFAULT_TTL_SEC = 12 * 3600;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCK_MINUTES = 15;

export class AuthService {
  private readonly tokenTtlSec: number;
  private readonly maxFailedAttempts: number;
  private readonly lockMinutes: number;
  private readonly jwtSecret: string;

  constructor(
    private readonly pdb: PeanutDatabase,
    options: AuthServiceOptions = {},
  ) {
    this.tokenTtlSec = options.tokenTtlSec ?? DEFAULT_TTL_SEC;
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.lockMinutes = options.lockMinutes ?? DEFAULT_LOCK_MINUTES;
    this.jwtSecret = deriveJwtSecret(pdb.getKey());
  }

  /** 把领域用户展开成请求上下文（角色 + 权限 + 资源授权）。 */
  buildContext(user: User, sessionId: string): AuthContext {
    const roles = this.pdb.users.rolesOf(user.id);
    const permissions = this.pdb.users.permissionsOf(user.id);
    const grants = new Map<string, string[]>();
    for (const g of this.pdb.users.grantsOf(user.id)) {
      grants.set(`${g.resourceType}:${g.resourceId}`, g.actions);
    }
    return { user, roles, permissions, grants, sessionId };
  }

  login(input: LoginInput): LoginResult {
    const username = input.username?.trim() ?? '';
    const password = input.password ?? '';
    if (!username || !password) {
      throw new PeanutError('VALIDATION_FAILED', '请输入用户名与密码');
    }

    const found = this.pdb.users.findByLogin(username);

    // 用户不存在也走一遍 scrypt，避免通过响应时间差枚举用户名
    if (!found) {
      verifySecret(password, null);
      this.auditLogin(null, username, 'failed', input, '用户名或密码错误');
      throw new PeanutError('AUTH_INVALID_CREDENTIALS', '用户名或密码错误');
    }

    if (found.status !== 1) {
      this.auditLogin(found, username, 'denied', input, '账号已被禁用');
      throw new PeanutError('AUTH_ACCOUNT_DISABLED', '账号已被禁用，请联系管理员');
    }

    if (found.lockedUntil && new Date(found.lockedUntil).getTime() > Date.now()) {
      this.auditLogin(found, username, 'denied', input, '账号已锁定');
      throw new PeanutError(
        'AUTH_ACCOUNT_LOCKED',
        `账号因连续登录失败已锁定至 ${found.lockedUntil}`,
        { lockedUntil: found.lockedUntil },
      );
    }

    if (!verifySecret(password, found.passwordHash)) {
      const { attempts, locked } = this.pdb.users.recordLoginFailure(found.id, {
        maxAttempts: this.maxFailedAttempts,
        lockMinutes: this.lockMinutes,
      });
      this.auditLogin(
        found,
        username,
        'failed',
        input,
        locked ? `密码错误（第 ${attempts} 次，账号已锁定）` : `密码错误（第 ${attempts} 次）`,
      );
      throw new PeanutError('AUTH_INVALID_CREDENTIALS', '用户名或密码错误', {
        attempts,
        maxAttempts: this.maxFailedAttempts,
      });
    }

    const sessionId = newId();
    const token = signToken(
      { sub: found.id, sid: sessionId, username: found.username },
      this.jwtSecret,
      this.tokenTtlSec,
    );
    const expiresAt = new Date(Date.now() + this.tokenTtlSec * 1000).toISOString();
    this.pdb.sessions.create({
      id: sessionId,
      userId: found.id,
      tokenHash: sha256Hex(token),
      expiresAt,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    this.pdb.users.recordLoginSuccess(found.id, input.ip ?? null);

    const ctx = this.buildContext(found, sessionId);
    this.pdb.audit.append({
      userId: found.id,
      username: found.username,
      action: 'login',
      resourceType: 'session',
      resourceId: sessionId,
      status: 'success',
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: { roles: ctx.roles },
    });

    return {
      token,
      expiresIn: this.tokenTtlSec,
      sessionId,
      user: this.pdb.users.toDTO(found),
      roles: ctx.roles,
      permissions: ctx.permissions,
    };
  }

  /** 校验令牌并还原请求上下文。任何失败都抛 401 语义的错误。 */
  authenticate(token: string): AuthContext {
    const result = verifyToken(token, this.jwtSecret);
    if (!result.ok) {
      if (result.reason === 'expired') {
        throw new PeanutError('AUTH_TOKEN_EXPIRED', '登录已过期，请重新登录');
      }
      throw new PeanutError('AUTH_TOKEN_INVALID', '登录凭证无效');
    }
    const session = this.pdb.sessions.findActiveByTokenHash(sha256Hex(token));
    if (!session) {
      throw new PeanutError('AUTH_TOKEN_INVALID', '会话已失效，请重新登录');
    }
    const user = this.pdb.users.findById(result.payload.sub);
    if (!user) throw new PeanutError('AUTH_TOKEN_INVALID', '用户不存在');
    if (user.status !== 1) throw new PeanutError('AUTH_ACCOUNT_DISABLED', '账号已被禁用');
    return this.buildContext(user, session.id);
  }

  /**
   * 续签令牌。
   *
   * 语义是**会话轮换**而不是"把旧令牌原样再签一次"：
   *  - 旧会话立即吊销，旧令牌随之失效（避免一个令牌被无限续命）；
   *  - 新令牌写入新会话，IP / User-Agent 沿用本次请求；
   *  - 续签也要留审计，便于排查异常续签。
   * 这样即使旧令牌泄露，攻击者拿到的令牌在用户续签后即失效。
   */
  refresh(
    ctx: AuthContext,
    input: { ip?: string | null; userAgent?: string | null } = {},
  ): LoginResult {
    const user = this.pdb.users.findById(ctx.user.id);
    if (!user) throw new PeanutError('AUTH_TOKEN_INVALID', '用户不存在');
    if (user.status !== 1) throw new PeanutError('AUTH_ACCOUNT_DISABLED', '账号已被禁用');

    this.pdb.sessions.revoke(ctx.sessionId);

    const sessionId = newId();
    const token = signToken(
      { sub: user.id, sid: sessionId, username: user.username },
      this.jwtSecret,
      this.tokenTtlSec,
    );
    const expiresAt = new Date(Date.now() + this.tokenTtlSec * 1000).toISOString();
    this.pdb.sessions.create({
      id: sessionId,
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });

    const fresh = this.buildContext(user, sessionId);
    this.pdb.audit.append({
      userId: user.id,
      username: user.username,
      action: 'login',
      resourceType: 'session',
      resourceId: sessionId,
      status: 'success',
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: { refreshedFrom: ctx.sessionId, roles: fresh.roles },
    });

    return {
      token,
      expiresIn: this.tokenTtlSec,
      sessionId,
      user: this.pdb.users.toDTO(user),
      roles: fresh.roles,
      permissions: fresh.permissions,
    };
  }

  logout(ctx: AuthContext, ip?: string | null): void {
    this.pdb.sessions.revoke(ctx.sessionId);
    this.pdb.audit.append({
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'logout',
      resourceType: 'session',
      resourceId: ctx.sessionId,
      status: 'success',
      ipAddress: ip ?? null,
    });
  }

  changePassword(
    ctx: AuthContext,
    oldPassword: string,
    newPassword: string,
    ip?: string | null,
  ): void {
    const current = this.pdb.users.getPasswordHash(ctx.user.id);
    if (!verifySecret(oldPassword, current)) {
      this.pdb.audit.append({
        userId: ctx.user.id,
        username: ctx.user.username,
        action: 'user_update',
        resourceType: 'user',
        resourceId: String(ctx.user.id),
        status: 'failed',
        errorMessage: '原密码错误',
        ipAddress: ip ?? null,
      });
      throw new PeanutError('AUTH_INVALID_CREDENTIALS', '原密码错误');
    }
    const weak = checkPasswordStrength(newPassword);
    if (weak) throw new PeanutError('VALIDATION_FAILED', weak);
    if (newPassword === oldPassword) {
      throw new PeanutError('VALIDATION_FAILED', '新密码不能与原密码相同');
    }

    this.pdb.users.setPassword(ctx.user.id, hashSecret(newPassword));
    // 改密后强制其他会话下线，只保留当前会话
    const revoked = this.pdb.sessions.revokeAllForUser(ctx.user.id);
    if (revoked > 0) {
      const session = this.pdb.sessions.findById(ctx.sessionId);
      if (session) {
        this.pdb.db.run('UPDATE sessions SET revoked_at = NULL WHERE id = ?', ctx.sessionId);
      }
    }
    // 只清除**改密的这个用户自己**的标记。
    // 旧实现写的是全局键，于是任意用户改密都会顺带解除管理员的强制改密。
    writeMustChangePassword(this.pdb, ctx.user.id, false);
    this.pdb.audit.append({
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'user_update',
      resourceType: 'user',
      resourceId: String(ctx.user.id),
      status: 'success',
      detail: { field: 'password', revokedSessions: revoked },
      ipAddress: ip ?? null,
    });
  }

  /** 管理员重置他人密码。 */
  resetPassword(ctx: AuthContext, userId: number, newPassword: string): void {
    const weak = checkPasswordStrength(newPassword);
    if (weak) throw new PeanutError('VALIDATION_FAILED', weak);
    this.pdb.users.setPassword(userId, hashSecret(newPassword));
    this.pdb.sessions.revokeAllForUser(userId);
    this.pdb.users.unlock(userId);
    this.pdb.audit.append({
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'user_update',
      resourceType: 'user',
      resourceId: String(userId),
      status: 'success',
      detail: { field: 'password', by: 'admin_reset' },
    });
  }

  private auditLogin(
    user: User | null,
    attemptedUsername: string,
    status: 'success' | 'failed' | 'denied',
    input: LoginInput,
    errorMessage?: string,
  ): void {
    this.pdb.audit.append({
      userId: user?.id ?? null,
      username: user?.username ?? attemptedUsername,
      action: 'login',
      resourceType: 'user',
      resourceId: attemptedUsername,
      status,
      errorMessage: errorMessage ?? null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }
}
