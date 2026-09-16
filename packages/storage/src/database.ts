/**
 * 花生苗数据库管理工具 - 本地 SQLite 访问层
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { ensureDataDir, resolveDataDir, resolveDbPath } from '@peanutsprout/core';

/** node:sqlite 允许的绑定值；undefined/boolean 需要归一化。 */
export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlParam = SqlValue | undefined | boolean;

export type Row = Record<string, unknown>;

function normalizeParams(params: SqlParam[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

export interface LocalDatabaseOptions {
  /** 直接指定库文件路径；默认 ~/.peanutsprout/peanutsprout.db */
  dbPath?: string;
  /** 数据目录；仅当未指定 dbPath 时生效 */
  dataDir?: string;
  /** 内存库，用于测试 */
  memory?: boolean;
}

/**
 * 本地库封装。所有 SQL 都经过 prepare + 绑定参数，字符串拼接一律禁止，
 * 这是 SQL 注入防护的第一道闸门（PRD 5.2）。
 */
export class LocalDatabase {
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly stmtCache = new Map<string, StatementSync>();
  private closed = false;
  /** 事务嵌套深度：0 表示未开启事务，>0 表示内层需要用 SAVEPOINT 而不是 BEGIN。 */
  private txDepth = 0;

  constructor(options: LocalDatabaseOptions = {}) {
    if (options.memory) {
      this.path = ':memory:';
      this.db = new DatabaseSync(':memory:');
    } else {
      if (!options.dbPath) ensureDataDir(options.dataDir ?? resolveDataDir());
      const path = options.dbPath ?? resolveDbPath(options.dataDir);
      this.path = path;
      this.db = new DatabaseSync(path);
    }
    this.applyPragmas();
  }

  private applyPragmas(): void {
    // WAL 提升并发读性能；内存库不支持 WAL，静默降级。
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      /* :memory: 等场景忽略 */
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA encoding = "UTF-8";');
  }

  private prepare(sql: string): StatementSync {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  /** 执行多条语句（DDL 脚本、PRAGMA），不返回结果。 */
  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    this.assertOpen();
    const r = this.prepare(sql).run(...normalizeParams(params));
    return {
      changes: Number(r.changes),
      lastInsertRowid: Number(r.lastInsertRowid),
    };
  }

  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    this.assertOpen();
    return this.prepare(sql).get(...normalizeParams(params)) as unknown as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    this.assertOpen();
    return this.prepare(sql).all(...normalizeParams(params)) as unknown as T[];
  }

  /** 行数统计的语法糖。 */
  count(sql: string, ...params: SqlParam[]): number {
    const row = this.get<{ c: number | bigint }>(sql, ...params);
    return row ? Number(row.c) : 0;
  }

  /**
   * IMMEDIATE 事务：写操作前先取写锁，避免升级锁导致的 SQLITE_BUSY。
   *
   * **支持嵌套**：SQL 的 `BEGIN` 不能嵌套（会报 "cannot start a transaction
   * within a transaction"），但仓储方法之间天然会互相调用 —— 例如
   * `users.create()` 内部会调用 `users.setRoles()`。若内层再发一次 `BEGIN`
   * 就会直接抛错，于是之前只能把内层调用挪到事务外面，代价是**失去原子性**：
   * 用户行已提交、角色写入却失败，留下一个没有角色却能登录的"半成品账号"。
   *
   * 因此这里按深度区分：最外层用 `BEGIN IMMEDIATE` / `COMMIT`，
   * 内层退化为 `SAVEPOINT`，这样内层失败只回滚内层、异常继续向外传播，
   * 外层再决定整体回滚。
   */
  transaction<T>(fn: () => T): T {
    this.assertOpen();

    if (this.txDepth > 0) {
      const name = `ps_sp_${(this.txDepth += 1)}`;
      this.db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        this.db.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        try {
          this.db.exec(`ROLLBACK TO ${name}`);
          this.db.exec(`RELEASE ${name}`);
        } catch {
          /* 回滚失败时保留原始异常 */
        }
        throw e;
      } finally {
        this.txDepth -= 1;
      }
    }

    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 回滚失败时保留原始异常 */
      }
      throw e;
    } finally {
      this.txDepth = 0;
    }
  }

  close(): void {
    if (this.closed) return;
    this.stmtCache.clear();
    this.db.close();
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('数据库连接已关闭');
  }
}

/** SQLite 的 CURRENT_TIMESTAMP 是 UTC 的 `YYYY-MM-DD HH:MM:SS`，统一转 ISO8601。 */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s) return null;
  if (s.includes('T')) return s;
  return `${s.replace(' ', 'T')}Z`;
}

export const nowIso = (): string => new Date().toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
