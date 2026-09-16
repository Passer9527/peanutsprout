/**
 * 花生苗数据库管理工具 - 本地库结构与内置数据初始化
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BASE_DDL, SEED_PERMISSIONS, SEED_ROLE_PERMISSIONS, SEED_ROLES, SEED_SETTINGS } from './ddl.js';
import type { LocalDatabase } from '../database.js';

export interface Migration {
  version: string;
  description: string;
  sql: string;
}

/**
 * 0002：去掉 audit_logs.user_id 上的外键约束。
 *
 * 原约束是 `ON DELETE SET NULL`，而 user_id 参与审计哈希链计算 —— 删除用户会把
 * 该用户的历史审计行 user_id 改写为 NULL，导致链校验**永久失败**
 * （已实测：删除用户后 verifyChain() 由 ok:true 变为 ok:false）。
 * SQLite 无法直接 DROP CONSTRAINT，只能重建表：建新表 → 搬数据 → 换名 → 重建索引。
 */
const MIGRATION_0002_AUDIT_DROP_FK = `
CREATE TABLE audit_logs_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,
    username      TEXT,
    action        TEXT NOT NULL,
    resource_type TEXT,
    resource_id   TEXT,
    connection_id INTEGER,
    detail        TEXT,
    sql_text      TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    status        TEXT NOT NULL,
    error_message TEXT,
    duration_ms   INTEGER,
    prev_hash     TEXT,
    curr_hash     TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO audit_logs_new
  (id, user_id, username, action, resource_type, resource_id, connection_id, detail, sql_text,
   ip_address, user_agent, status, error_message, duration_ms, prev_hash, curr_hash, created_at)
SELECT
   id, user_id, username, action, resource_type, resource_id, connection_id, detail, sql_text,
   ip_address, user_agent, status, error_message, duration_ms, prev_hash, curr_hash, created_at
FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_conn ON audit_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
`;

/**
 * 0003：给 audit_logs 增加 hash_version（审计哈希版本号）。
 *
 * 背景：v1 规范化只覆盖 11 个字段，ip_address / user_agent / duration_ms 三列
 * 写进了表却不参与哈希（可直接改而不破坏链）；而且 `x ?? ''` 把 null 与 ''
 * 折叠成同一个值，留下了构造碰撞的空间。修复必须改规范化算法，但**不能**直接
 * 改 v1：真实用户库里已经有历史行用 v1 哈希，直接改会让它们全部校验失败，
 * 等于永久打断链。
 *
 * 因此用「行级版本号」而不是整体换算法：本迁移用 ADD COLUMN 给历史行统一补上
 * 默认值 1（它们仍按 v1 校验），新写入由应用层显式写 2（按 v2 校验）。
 * SQLite 的 ADD COLUMN 带非空默认值是原地元数据操作，**不会重写任何既有行**，
 * 因此所有历史行的 prev_hash / curr_hash 原封不动，链不受影响。
 */
const MIGRATION_0003_AUDIT_HASH_VERSION = `
ALTER TABLE audit_logs ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1;
`;

/**
 * 迁移列表，只增不改。已应用的版本记录在 schema_migrations 表里。
 * 新增结构变更时追加一条，切勿修改历史条目。
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: '0001_init', description: '初始结构：用户权限、连接、历史、审计、AI、迁移、看板、任务、插件、设置', sql: BASE_DDL },
  {
    version: '0002_audit_drop_user_fk',
    description: '审计日志改为不可变：移除 audit_logs.user_id 外键（原 ON DELETE SET NULL 会让删除用户打断哈希链）',
    sql: MIGRATION_0002_AUDIT_DROP_FK,
  },
  {
    version: '0003_audit_hash_version',
    description: '审计哈希版本化：新增 audit_logs.hash_version，老行按 v1 校验、新行按 v2（纳入 IP/UA/耗时并区分 null 与空串）',
    sql: MIGRATION_0003_AUDIT_HASH_VERSION,
  },
] as const;

export interface InitResult {
  applied: string[];
  alreadyApplied: string[];
  schemaVersion: string;
}

export function runMigrations(db: LocalDatabase): InitResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  const applied = new Set(
    db.all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version),
  );
  const newlyApplied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) {
      alreadyApplied.push(m.version);
      continue;
    }
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version) VALUES (?)', m.version);
    });
    newlyApplied.push(m.version);
  }

  return {
    applied: newlyApplied,
    alreadyApplied,
    schemaVersion: MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 'none',
  };
}

/** 写入内置角色、权限、角色权限绑定与默认设置（幂等）。 */
export function seedBuiltinData(db: LocalDatabase): void {
  db.transaction(() => {
    db.exec(SEED_ROLES);
    db.exec(SEED_PERMISSIONS);
    db.exec(SEED_ROLE_PERMISSIONS);
    db.exec(SEED_SETTINGS);
  });
}

/** 建表 + 内置数据，一步到位。 */
export function initializeSchema(db: LocalDatabase): InitResult {
  const result = runMigrations(db);
  seedBuiltinData(db);
  return result;
}
