/**
 * 花生苗数据库管理工具 - 用户 / 角色 / 权限 / 审计 模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  status: number;
  isAdmin: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDTO {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  status: number;
  isAdmin: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  isBuiltin: boolean;
}

/** 权限码（PRD 第八部分初始化数据）。 */
export type PermissionCode =
  | 'conn.read'
  | 'conn.write'
  | 'query.read'
  | 'query.write'
  | 'migrate.read'
  | 'migrate.write'
  | 'ai.use'
  | 'user.manage'
  | 'audit.read'
  | 'settings.manage';

export interface Permission {
  id: number;
  code: PermissionCode | string;
  name: string;
  category: string | null;
  description: string | null;
}

export interface ResourceGrant {
  id: number;
  userId: number;
  resourceType: 'connection' | 'schema' | 'table';
  resourceId: string;
  actions: string[];
  createdAt: string;
}

export type AuditAction =
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'connect'
  | 'disconnect'
  | 'execute'
  | 'migrate'
  | 'import'
  | 'export'
  | 'ai'
  | 'user_create'
  | 'user_update'
  | 'user_delete'
  | 'connection_create'
  | 'connection_update'
  | 'connection_delete'
  | 'settings_update'
  | 'audit_verify';

export interface AuditEvent {
  userId: number | null;
  username: string | null;
  action: AuditAction | string;
  resourceType?: string | null;
  resourceId?: string | null;
  connectionId?: number | null;
  detail?: unknown;
  sqlText?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  status: 'success' | 'failed' | 'denied' | string;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export interface AuditLogEntry extends AuditEvent {
  id: number;
  prevHash: string | null;
  currHash: string | null;
  createdAt: string;
}

export interface AuditQuery {
  userId?: number;
  username?: string;
  action?: string;
  connectionId?: number;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuthContext {
  user: User;
  roles: string[];
  permissions: string[];
  /** 资源级授权：connection id -> actions */
  grants: Map<string, string[]>;
  sessionId: string;
}

export const BUILTIN_ROLES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'admin', description: '管理员，拥有全部权限' },
  { name: 'developer', description: '开发者，可读写授权连接' },
  { name: 'readonly', description: '只读用户，仅可查询' },
];

export const BUILTIN_PERMISSIONS: ReadonlyArray<{
  code: string;
  name: string;
  category: string;
}> = [
  { code: 'conn.read', name: '查看连接', category: 'connection' },
  { code: 'conn.write', name: '管理连接', category: 'connection' },
  { code: 'query.read', name: '执行查询', category: 'query' },
  { code: 'query.write', name: '执行写操作', category: 'query' },
  { code: 'migrate.read', name: '查看迁移', category: 'migration' },
  { code: 'migrate.write', name: '执行迁移', category: 'migration' },
  { code: 'ai.use', name: '使用 AI', category: 'ai' },
  { code: 'user.manage', name: '用户管理', category: 'user' },
  { code: 'audit.read', name: '查看审计', category: 'audit' },
  { code: 'settings.manage', name: '系统设置', category: 'settings' },
];

/** 内置角色 -> 权限码映射，初始化时写入 role_permissions。 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: BUILTIN_PERMISSIONS.map((p) => p.code),
  developer: ['conn.read', 'query.read', 'query.write', 'migrate.read', 'migrate.write', 'ai.use'],
  readonly: ['conn.read', 'query.read'],
};
