/**
 * 花生苗数据库管理工具 - 会话与设置仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { PeanutError } from '@peanutsprout/core';
import { nowIso, toIso, type LocalDatabase } from '../database.js';

export interface SessionRecord {
  id: string;
  userId: number;
  tokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface SessionRow {
  id: string;
  user_id: number;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

const toRecord = (r: SessionRow): SessionRecord => ({
  id: r.id,
  userId: r.user_id,
  tokenHash: r.token_hash,
  ipAddress: r.ip_address,
  userAgent: r.user_agent,
  createdAt: toIso(r.created_at) ?? '',
  expiresAt: toIso(r.expires_at) ?? '',
  revokedAt: toIso(r.revoked_at),
});

export class SessionRepository {
  constructor(private readonly db: LocalDatabase) {}

  create(input: {
    id: string;
    userId: number;
    tokenHash: string;
    expiresAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.id,
      input.userId,
      input.tokenHash,
      input.expiresAt,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    );
  }

  /** 查找仍然有效的会话（未吊销、未过期）。 */
  findActiveByTokenHash(tokenHash: string): SessionRecord | null {
    const row = this.db.get<SessionRow>(
      `SELECT * FROM sessions
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      tokenHash,
      nowIso(),
    );
    return row ? toRecord(row) : null;
  }

  findById(id: string): SessionRecord | null {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    return row ? toRecord(row) : null;
  }

  revoke(id: string): boolean {
    return (
      this.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), id)
        .changes > 0
    );
  }

  revokeByTokenHash(tokenHash: string): boolean {
    return (
      this.db.run(
        'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
        nowIso(),
        tokenHash,
      ).changes > 0
    );
  }

  revokeAllForUser(userId: number): number {
    return this.db.run(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      nowIso(),
      userId,
    ).changes;
  }

  listActive(userId?: number): SessionRecord[] {
    const rows = userId
      ? this.db.all<SessionRow>(
          'SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
          userId,
          nowIso(),
        )
      : this.db.all<SessionRow>(
          'SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
          nowIso(),
        );
    return rows.map(toRecord);
  }

  cleanupExpired(olderThanDays = 30): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    return this.db.run('DELETE FROM sessions WHERE expires_at < ?', cutoff).changes;
  }
}

/**
 * **可写设置白名单**。
 *
 * 设置项是「键 → 值」的开放表，若接口允许写任意键，任何拥有 `settings.manage`
 * 的人都能凭空造出配置项（甚至覆盖掉程序不认识、但别的模块会读的键）。
 * 因此写入口只认这张表：白名单外的键一律 `VALIDATION_FAILED`。
 *
 * 同时也在这里声明**类型与取值范围**，把校验放在存储层，
 * 避免每个调用方（REST / CLI / 未来的 GUI）各写一遍校验逻辑而逐渐漂移。
 */
export interface WritableSettingSpec {
  category: string;
  type: 'boolean' | 'integer' | 'enum';
  /** integer 的取值范围 */
  min?: number;
  max?: number;
  /** enum 的合法取值 */
  values?: readonly string[];
  /** 给界面的简短说明（中文，界面文案另有 i18n） */
  note: string;
}

export const WRITABLE_SETTINGS: Record<string, WritableSettingSpec> = {
  'ai.enabled': {
    category: 'ai',
    type: 'boolean',
    note: 'AI 功能总开关。关闭时所有 AI 场景直接返回 AI_DISABLED',
  },
  'ai.redaction_enabled': {
    category: 'ai',
    type: 'boolean',
    note: '发送给大模型前对结果集做敏感字段脱敏',
  },
  'ai.production_write_allowed': {
    category: 'ai',
    type: 'boolean',
    note: '是否允许 AI 对生产连接生成写语句（默认禁止）',
  },
  'query.max_rows': {
    category: 'query',
    type: 'integer',
    min: 1,
    max: 1_000_000,
    note: '单次查询返回行数上限',
  },
  'query.timeout_ms': {
    category: 'query',
    type: 'integer',
    min: 100,
    max: 3_600_000,
    note: '查询超时（毫秒）',
  },
  'query.slow_threshold_ms': {
    category: 'query',
    type: 'integer',
    min: 1,
    max: 3_600_000,
    note: '慢查询判定阈值（毫秒）',
  },
  'security.readonly_default': {
    category: 'security',
    type: 'boolean',
    note: '新建连接是否默认只读',
  },
  'security.audit_retention_days': {
    category: 'security',
    type: 'integer',
    min: 1,
    max: 3650,
    note: '审计日志保留天数',
  },
  'security.auto_lock_minutes': {
    category: 'security',
    type: 'integer',
    min: 1,
    max: 1440,
    note: '空闲自动锁定（分钟）',
  },
};

export class SettingsRepository {
  constructor(private readonly db: LocalDatabase) {}

  get(key: string, fallback: string | null = null): string | null {
    const row = this.db.get<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    return row?.value ?? fallback;
  }

  getNumber(key: string, fallback: number): number {
    const raw = this.get(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.get(key);
    if (raw === null) return fallback;
    return raw === 'true' || raw === '1';
  }

  /**
   * 按白名单写入一项设置，返回旧值（用于审计留痕）。
   *
   * 白名单外的键、类型不符或越界的值一律抛 `VALIDATION_FAILED` ——
   * 绝不静默忽略，否则界面会以为保存成功。
   */
  setValidated(key: string, rawValue: unknown): { key: string; oldValue: string | null; newValue: string } {
    const spec = WRITABLE_SETTINGS[key];
    if (!spec) {
      throw new PeanutError('VALIDATION_FAILED', `不支持修改该设置项：${key}`, {
        key,
        writable: Object.keys(WRITABLE_SETTINGS),
      });
    }

    let value: string;
    if (spec.type === 'boolean') {
      if (typeof rawValue === 'boolean') value = String(rawValue);
      else if (rawValue === 'true' || rawValue === 'false') value = rawValue;
      else {
        throw new PeanutError('VALIDATION_FAILED', `设置项 ${key} 需要布尔值`, {
          key,
          received: rawValue === null ? 'null' : typeof rawValue,
        });
      }
    } else if (spec.type === 'integer') {
      const n = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (!Number.isInteger(n)) {
        throw new PeanutError('VALIDATION_FAILED', `设置项 ${key} 需要整数`, {
          key,
          received: rawValue === null ? 'null' : String(rawValue),
        });
      }
      if (spec.min !== undefined && n < spec.min) {
        throw new PeanutError('VALIDATION_FAILED', `设置项 ${key} 不能小于 ${spec.min}`, { key, min: spec.min });
      }
      if (spec.max !== undefined && n > spec.max) {
        throw new PeanutError('VALIDATION_FAILED', `设置项 ${key} 不能大于 ${spec.max}`, { key, max: spec.max });
      }
      value = String(n);
    } else {
      const s = String(rawValue);
      if (spec.values && !spec.values.includes(s)) {
        throw new PeanutError('VALIDATION_FAILED', `设置项 ${key} 只能是：${spec.values.join(' / ')}`, {
          key,
          values: spec.values,
        });
      }
      value = s;
    }

    const oldValue = this.get(key);
    this.set(key, value, spec.category);
    return { key, oldValue, newValue: value };
  }

  /** 批量写入，整体在一个事务内；任一项非法则全部回滚。 */
  setManyValidated(
    items: Array<{ key: string; value: unknown }>,
  ): Array<{ key: string; oldValue: string | null; newValue: string }> {
    return this.db.transaction(() => items.map((item) => this.setValidated(item.key, item.value)));
  }

  set(key: string, value: string | number | boolean, category = 'general'): void {
    const v = typeof value === 'boolean' ? String(value) : String(value);
    this.db.run(
      `INSERT INTO settings (key, value, category, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updated_at = excluded.updated_at`,
      key,
      v,
      category,
      nowIso(),
    );
  }

  all(): Array<{ key: string; value: string | null; category: string | null; updatedAt: string }> {
    return this.db
      .all<{ key: string; value: string | null; category: string | null; updated_at: string }>(
        'SELECT key, value, category, updated_at FROM settings ORDER BY category, key',
      )
      .map((r) => ({
        key: r.key,
        value: r.value,
        category: r.category,
        updatedAt: toIso(r.updated_at) ?? '',
      }));
  }
}
