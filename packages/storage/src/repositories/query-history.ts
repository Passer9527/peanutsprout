/**
 * 花生苗数据库管理工具 - SQL 执行历史仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { QueryHistoryEntry } from '@peanutsprout/core';
import { sha256Hex } from '../crypto.js';
import { nowIso, toIso, type LocalDatabase, type SqlParam } from '../database.js';

interface HistoryRow {
  id: number;
  user_id: number;
  connection_id: number | null;
  connection_name: string | null;
  sql_text: string;
  sql_hash: string | null;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  affected_rows: number | null;
  result_rows: number | null;
  is_slow: number;
  executed_at: string;
}

export interface QueryHistoryInput {
  userId: number;
  connectionId: number | null;
  sqlText: string;
  status: 'success' | 'failed' | 'cancelled';
  errorMessage?: string | null;
  durationMs?: number | null;
  affectedRows?: number | null;
  resultRows?: number | null;
  isSlow?: boolean;
}

export interface QueryHistoryFilter {
  userId?: number;
  connectionId?: number;
  onlySlow?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class QueryHistoryRepository {
  constructor(private readonly db: LocalDatabase) {}

  append(input: QueryHistoryInput): number {
    return this.db.run(
      `INSERT INTO query_history
         (user_id, connection_id, sql_text, sql_hash, status, error_message,
          duration_ms, affected_rows, result_rows, is_slow, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      input.connectionId,
      input.sqlText,
      sha256Hex(input.sqlText),
      input.status,
      input.errorMessage ?? null,
      input.durationMs ?? null,
      input.affectedRows ?? null,
      input.resultRows ?? null,
      input.isSlow ? 1 : 0,
      nowIso(),
    ).lastInsertRowid;
  }

  list(filter: QueryHistoryFilter = {}): QueryHistoryEntry[] {
    const { whereSql, params } = this.buildWhere(filter);
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
    const offset = Math.max(filter.offset ?? 0, 0);
    return this.db
      .all<HistoryRow>(
        `SELECT h.*, c.name AS connection_name
         FROM query_history h
         LEFT JOIN connections c ON c.id = h.connection_id
         ${whereSql}
         ORDER BY h.id DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      )
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        connectionId: r.connection_id,
        connectionName: r.connection_name,
        sqlText: r.sql_text,
        status: r.status as QueryHistoryEntry['status'],
        errorMessage: r.error_message,
        durationMs: r.duration_ms,
        affectedRows: r.affected_rows,
        resultRows: r.result_rows,
        isSlow: Number(r.is_slow) === 1,
        executedAt: toIso(r.executed_at) ?? '',
      }));
  }

  count(filter: QueryHistoryFilter = {}): number {
    const { whereSql, params } = this.buildWhere(filter);
    return this.db.count(`SELECT COUNT(*) AS c FROM query_history h ${whereSql}`, ...params);
  }

  private buildWhere(filter: QueryHistoryFilter): { whereSql: string; params: SqlParam[] } {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (filter.userId !== undefined) {
      where.push('h.user_id = ?');
      params.push(filter.userId);
    }
    if (filter.connectionId !== undefined) {
      where.push('h.connection_id = ?');
      params.push(filter.connectionId);
    }
    if (filter.onlySlow) where.push('h.is_slow = 1');
    if (filter.search) {
      where.push('h.sql_text LIKE ?');
      params.push(`%${filter.search}%`);
    }
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  clear(olderThanIso?: string): number {
    if (olderThanIso) {
      return this.db.run('DELETE FROM query_history WHERE executed_at < ?', olderThanIso).changes;
    }
    return this.db.run('DELETE FROM query_history').changes;
  }
}
