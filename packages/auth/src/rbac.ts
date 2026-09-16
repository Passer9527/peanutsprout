/**
 * 花生苗数据库管理工具 - 访问控制（RBAC + 资源级授权 + 只读保护）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 授权模型（PRD 4.6 权限控制）：
 *  1. 角色权限：角色 -> 权限码（conn.read / query.write ...）；
 *  2. 资源级授权：resource_grants 表按 connection/schema/table 逐条授权；
 *  3. 只读保护：连接自身 is_read_only=1 时，任何写操作一律拒绝；
 *  4. 生产库保护：颜色标记为红/名称含 prod 的连接，AI 写操作默认禁止。
 *
 * 连接可见范围规则（避免"新用户看不到任何连接"的死角）：
 *  - 管理员：全部可见；
 *  - 普通用户：只要**存在任何授权记录**就进入白名单模式，且只有 connection 级授权
 *    能带来可见性（schema/table 级授权无法映射到连接，不单独授予可见性）；
 *    一条授权都没有时，才按角色权限放行全部连接（角色模式）。
 *    注意判据是"有没有授权记录"而不是"有没有连接级授权"—— 详见 resolveConnectionScope。
 */

import { PeanutError, isProductionLike, type AuthContext } from '@peanutsprout/core';

export type ConnectionScope = { mode: 'all' } | { mode: 'list'; ids: number[] };

/**
 * 只读标记的形状：领域层 ConnectionConfig 用 readOnly，
 * 传输层 ConnectionDTO 用 isReadOnly，这里两者都接受。
 */
export interface ReadOnlyFlags {
  readOnly?: boolean | null;
  isReadOnly?: boolean | null;
}

function readOnlyOf(connection?: ReadOnlyFlags | null): boolean {
  if (!connection) return false;
  return connection.readOnly === true || connection.isReadOnly === true;
}

export function hasPermission(ctx: AuthContext, code: string): boolean {
  if (ctx.user.isAdmin) return true;
  // 与资源授权的 actions 保持一致：'*' 视为通配，便于将来增加自定义超级角色
  return ctx.permissions.includes(code) || ctx.permissions.includes('*');
}

export function assertPermission(ctx: AuthContext, code: string, message?: string): void {
  if (!hasPermission(ctx, code)) {
    throw new PeanutError('AUTH_FORBIDDEN', message ?? `缺少权限: ${code}`);
  }
}

/**
 * 计算用户的连接可见范围。
 *
 * 这里有一个容易写错的边界：判断"进入白名单模式"必须看**有没有任何授权记录**，
 * 而不是"有没有连接级授权"。早期实现用后者，于是管理员只给某用户一条
 * `table:...` 或 `schema:...` 授权时，connection 级授权数为 0 →
 * 函数返回 `{ mode: 'all' }` → 该用户反而看得见（并能写）**系统里的每一个连接**，
 * 而管理员的预期是"他只被授权了一张表"。授权越少、权限越大，属于典型的提权缺陷。
 *
 * 现在的规则：
 *  - 没有任何授权记录 → 角色模式（按角色权限放行全部连接）；
 *  - 有任何授权记录 → 白名单模式，且只有 connection 级授权能带来可见性
 *    （schema/table 级授权无法映射到连接，因此不单独授予连接可见性）。
 */
export function resolveConnectionScope(ctx: AuthContext): ConnectionScope {
  if (ctx.user.isAdmin) return { mode: 'all' };
  if (ctx.grants.size === 0) return { mode: 'all' };
  const ids = [...ctx.grants.keys()]
    .filter((key) => key.startsWith('connection:'))
    .map((key) => Number(key.slice('connection:'.length)))
    .filter(Number.isFinite);
  return { mode: 'list', ids };
}

export function canSeeConnection(ctx: AuthContext, connectionId: number): boolean {
  const scope = resolveConnectionScope(ctx);
  if (scope.mode === 'all') return true;
  return scope.ids.includes(connectionId);
}

/** 连接级写权限：既要角色权限，也要资源授权，还要连接自身不是只读。 */
export function canWriteConnection(
  ctx: AuthContext,
  connectionId: number,
  connection?: ReadOnlyFlags | null,
): boolean {
  if (!hasPermission(ctx, 'query.write')) return false;
  if (readOnlyOf(connection)) return false;
  if (ctx.user.isAdmin) return true;
  const scope = resolveConnectionScope(ctx);
  if (scope.mode === 'all') return true;
  const actions = ctx.grants.get(`connection:${connectionId}`) ?? [];
  return actions.includes('write') || actions.includes('*');
}

export function assertConnectionVisible(ctx: AuthContext, connectionId: number): void {
  if (!canSeeConnection(ctx, connectionId)) {
    // 关键：对"连接不存在"与"连接存在但未授权"返回**完全相同**的 NOT_FOUND。
    // 若这里返回 403，攻击者就能靠状态码差异枚举出系统里存在哪些连接 id，
    // 与"普通用户只能看到被授权的连接"（验收标准 AC-05）相矛盾。
    throw new PeanutError('NOT_FOUND', `连接不存在: ${connectionId}`);
  }
}

export function assertCanWrite(
  ctx: AuthContext,
  connectionId: number,
  connection?: ReadOnlyFlags | null,
): void {
  assertConnectionVisible(ctx, connectionId);
  if (!hasPermission(ctx, 'query.write')) {
    throw new PeanutError('AUTH_FORBIDDEN', '当前账号为只读账号，禁止执行写操作');
  }
  if (readOnlyOf(connection)) {
    throw new PeanutError('READONLY_VIOLATION', '该连接已开启只读保护，禁止执行写操作');
  }
  if (!canWriteConnection(ctx, connectionId, connection)) {
    throw new PeanutError('AUTH_FORBIDDEN', '未获得该连接的写授权');
  }
}

/** 生产库识别：用于 AI 写操作默认禁止与界面红标提示。 */
export function isProductionConnection(connection: {
  name?: string | null;
  colorTag?: string | null;
  readOnly?: boolean;
}): boolean {
  if (connection.readOnly) return true;
  return isProductionLike(connection.colorTag ?? null, connection.name ?? null);
}

/** AI 写操作闸门（PRD 4.5 安全与可控）。 */
export function assertAiWriteAllowed(
  ctx: AuthContext,
  connection: { name?: string | null; colorTag?: string | null; readOnly?: boolean } | null,
  opts: { productionWriteAllowed: boolean; aiEnabled: boolean },
): void {
  if (!opts.aiEnabled) throw new PeanutError('AI_DISABLED', 'AI 功能已被管理员禁用');
  assertPermission(ctx, 'ai.use', '当前账号无 AI 使用权限');
  if (connection && !opts.productionWriteAllowed && isProductionConnection(connection)) {
    throw new PeanutError('CONFIRMATION_REQUIRED', '生产库默认禁止 AI 执行写操作，请由人工确认后在 SQL 编辑器中执行');
  }
}
