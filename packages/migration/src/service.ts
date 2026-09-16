/**
 * 花生苗数据库管理工具 - 迁移任务服务（落库与报告）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 引擎负责"搬数据"，本服务负责"留痕"：任务状态、预检结果、检查点、失败明细，
 * 全部落到本地库的 migrations / migration_checkpoints / migration_errors 三张表，
 * 从而支持断点续传与迁移报告（PRD M05-08、M05-09）。
 */

import {
  notFound,
  PeanutError,
  type MigrationPrecheckResult,
  type MigrationRequest,
} from '@peanutsprout/core';
import { nowIso, toIso, type PeanutDatabase } from '@peanutsprout/storage';
import type { MigrationEngine, MigrationOutcome, TableMigrationReport } from './engine.js';

interface MigrationRow {
  id: number;
  user_id: number;
  name: string | null;
  source_conn_id: number;
  target_conn_id: number;
  source_schema: string | null;
  target_schema: string | null;
  tables: string | null;
  mode: string;
  status: string;
  precheck_result: string | null;
  total_rows: number | null;
  success_rows: number | null;
  failed_rows: number | null;
  skipped_rows: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface MigrationTaskDTO {
  id: number;
  name: string | null;
  userId: number;
  sourceConnectionId: number;
  targetConnectionId: number;
  sourceSchema: string | null;
  targetSchema: string | null;
  tables: string[];
  mode: string;
  status: string;
  totalRows: number | null;
  successRows: number | null;
  failedRows: number | null;
  skippedRows: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** 检查点里保存的逐表分页/状态元信息，供迁移报告显式展示分页方式。 */
export interface CheckpointPagination {
  pagination: string;
  orderBy: string[];
  status: string;
  message: string | null;
}

/**
 * 进程内迁移互斥锁：为"同一目标连接 + 同一 schema + 同一目标表"提供互斥。
 *
 * 为什么需要它：两个并发迁移若同时看到目标表为空，会各自全量插入，
 * 目标表出现成倍重复数据；overwrite 策略下还会互相 DROP 对方正在写的表。
 * 任务级的状态抢占（条件 UPDATE）只能挡住"同一个任务"，挡不住"两个任务写同一张表"。
 *
 * tables 为空表示整库迁移：用 `table = null` 的通配锁，与任何同库同 schema 的表锁互斥。
 */
class MigrationLockRegistry {
  private readonly held: Array<{ connId: number; schema: string; table: string | null; taskId: number }> = [];

  /** 获取锁；若有冲突直接抛 CONFLICT。返回释放函数（必须在 finally 中调用）。 */
  acquire(connId: number, schema: string, tables: string[], taskId: number): () => void {
    const requested: Array<{ table: string | null }> =
      tables.length > 0 ? tables.map((table) => ({ table })) : [{ table: null }];

    const overlap = this.held.find(
      (h) =>
        h.connId === connId &&
        h.schema === schema &&
        requested.some((r) => r.table === null || h.table === null || r.table === h.table),
    );
    if (overlap) {
      throw new PeanutError(
        'CONFLICT',
        `目标表正在被迁移任务 ${overlap.taskId} 占用，请等待其结束后重试`,
        { taskId: overlap.taskId, targetConnectionId: connId, schema },
      );
    }

    const entries = requested.map((r) => ({ connId, schema, table: r.table, taskId }));
    this.held.push(...entries);
    return () => {
      for (const entry of entries) {
        const index = this.held.indexOf(entry);
        if (index >= 0) this.held.splice(index, 1);
      }
    };
  }
}

export class MigrationService {
  private readonly locks = new MigrationLockRegistry();

  constructor(
    private readonly pdb: PeanutDatabase,
    private readonly engine: MigrationEngine,
  ) {}

  private toDTO(row: MigrationRow): MigrationTaskDTO {
    let tables: string[] = [];
    if (row.tables) {
      try {
        const parsed = JSON.parse(row.tables);
        if (Array.isArray(parsed)) tables = parsed.map(String);
      } catch {
        tables = [];
      }
    }
    return {
      id: row.id,
      name: row.name,
      userId: row.user_id,
      sourceConnectionId: row.source_conn_id,
      targetConnectionId: row.target_conn_id,
      sourceSchema: row.source_schema,
      targetSchema: row.target_schema,
      tables,
      mode: row.mode,
      status: row.status,
      totalRows: row.total_rows,
      successRows: row.success_rows,
      failedRows: row.failed_rows,
      skippedRows: row.skipped_rows,
      errorMessage: row.error_message,
      startedAt: toIso(row.started_at),
      finishedAt: toIso(row.finished_at),
      createdAt: toIso(row.created_at) ?? '',
    };
  }

  create(request: MigrationRequest): number {
    return this.pdb.db.run(
      `INSERT INTO migrations
         (user_id, name, source_conn_id, target_conn_id, source_schema, target_schema, tables, mode, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      request.userId,
      request.name ?? null,
      request.sourceConnectionId,
      request.targetConnectionId,
      request.sourceSchema,
      request.targetSchema,
      JSON.stringify(request.tables ?? []),
      request.mode,
    ).lastInsertRowid;
  }

  get(id: number): MigrationTaskDTO {
    const row = this.pdb.db.get<MigrationRow>('SELECT * FROM migrations WHERE id = ?', id);
    if (!row) throw notFound('迁移任务', id);
    return this.toDTO(row);
  }

  list(options: { userId?: number; limit?: number; offset?: number } = {}): MigrationTaskDTO[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const rows = options.userId
      ? this.pdb.db.all<MigrationRow>(
          'SELECT * FROM migrations WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
          options.userId,
          limit,
          offset,
        )
      : this.pdb.db.all<MigrationRow>(
          'SELECT * FROM migrations ORDER BY id DESC LIMIT ? OFFSET ?',
          limit,
          offset,
        );
    return rows.map((r) => this.toDTO(r));
  }

  /** 预检并落库预检结果，供界面展示"迁移预检报告"。 */
  async precheck(id: number, request: MigrationRequest): Promise<MigrationPrecheckResult> {
    this.pdb.db.run("UPDATE migrations SET status = 'prechecking' WHERE id = ?", id);
    try {
      const result = await this.engine.precheck(request);
      this.pdb.db.run(
        "UPDATE migrations SET precheck_result = ?, status = 'pending', total_rows = ? WHERE id = ?",
        JSON.stringify(result),
        Math.round(result.estimatedRows),
        id,
      );
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.pdb.db.run("UPDATE migrations SET status = 'failed', error_message = ? WHERE id = ?", message, id);
      throw e;
    }
  }

  /**
   * 执行迁移，并保证状态与统计落库（无论成功失败）。
   *
   * 并发保护分两层：
   *  1. **任务级**：条件 UPDATE 抢占，只有当前状态允许启动时才把它置为 running，
   *     `changes === 0` 说明别人已经把它跑起来了（或状态不允许），直接拒绝；
   *  2. **目标表级**：同一目标连接 + 同一张表的迁移互斥，异常路径也会释放锁。
   */
  async start(id: number, request: MigrationRequest): Promise<MigrationOutcome> {
    const release = this.locks.acquire(
      request.targetConnectionId,
      request.targetSchema ?? '',
      request.tables ?? [],
      id,
    );

    try {
      // 条件更新是关键：不能无条件置 running，否则两个并发请求会互相覆盖
      // started_at / 检查点 / 最终统计，且都以为自己抢到了任务。
      const claimed = this.pdb.db.run(
        `UPDATE migrations SET status = 'running', started_at = ?, error_message = NULL
           WHERE id = ? AND status IN ('pending','failed','cancelled','success','skipped')`,
        nowIso(),
        id,
      );
      if (claimed.changes === 0) {
        const row = this.pdb.db.get<{ status: string }>('SELECT status FROM migrations WHERE id = ?', id);
        if (!row) throw notFound('迁移任务', id);
        throw new PeanutError(
          'CONFLICT',
          `迁移任务 ${id} 当前状态为 ${row.status}，不允许重复启动（仅 pending/failed/cancelled/success/skipped 可启动）`,
          { taskId: id, status: row.status },
        );
      }

      try {
        const result = await this.engine.migrate(
          { ...request, id: String(id) },
          (progress) => {
            // 检查点：记录每张表已处理到的行数，断点续传依赖它。
            // migration_checkpoints 上没有 (migration_id, table_name) 唯一约束，
            // 因此用「先删后插」保证每张表恰好一行检查点。
            if (!progress.table) return;
            this.pdb.db.transaction(() => {
              this.pdb.db.run(
                'DELETE FROM migration_checkpoints WHERE migration_id = ? AND table_name = ?',
                id,
                progress.table,
              );
              this.pdb.db.run(
                'INSERT INTO migration_checkpoints (migration_id, table_name, last_offset, updated_at) VALUES (?, ?, ?, ?)',
                id,
                progress.table,
                progress.processedRows,
                nowIso(),
              );
            });
          },
        );

        this.pdb.db.transaction(() => {
          this.pdb.db.run(
            `UPDATE migrations SET status = ?, total_rows = ?, success_rows = ?, failed_rows = ?,
               skipped_rows = ?, finished_at = ? WHERE id = ?`,
            result.status,
            Math.round(result.totalRows),
            result.successRows,
            result.failedRows,
            result.skippedRows,
            nowIso(),
            id,
          );
          for (const err of result.errors.slice(0, 1000)) {
            this.pdb.db.run(
              'INSERT INTO migration_errors (migration_id, table_name, row_key, error_message) VALUES (?, ?, ?, ?)',
              id,
              err.table,
              err.rowKey,
              err.message,
            );
          }
          // 把逐表的分页方式/跳过原因写进检查点（复用已有的 last_key 列），
          // 这样 GET /migration/:id/report 也能显式展示"这张表是怎么分页的"。
          for (const table of result.tables) {
            this.saveTableReport(id, table);
          }
        });

        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.pdb.db.run(
          "UPDATE migrations SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?",
          message,
          nowIso(),
          id,
        );
        throw e;
      }
    } finally {
      // 无论成功、失败还是取消，锁都必须释放，否则后续迁移会被永久阻塞。
      release();
    }
  }

  /** 把单表分页/状态元信息写入检查点（没有检查点行时补一行）。 */
  private saveTableReport(id: number, table: TableMigrationReport): void {
    const meta = JSON.stringify({
      pagination: table.pagination,
      orderBy: table.orderBy,
      status: table.status,
      message: table.message ?? null,
    });
    const existing = this.pdb.db.get<{ id: number }>(
      'SELECT id FROM migration_checkpoints WHERE migration_id = ? AND table_name = ?',
      id,
      table.table,
    );
    if (existing) {
      this.pdb.db.run(
        'UPDATE migration_checkpoints SET last_key = ?, updated_at = ? WHERE id = ?',
        meta,
        nowIso(),
        existing.id,
      );
    } else {
      this.pdb.db.run(
        'INSERT INTO migration_checkpoints (migration_id, table_name, last_key, updated_at) VALUES (?, ?, ?, ?)',
        id,
        table.table,
        meta,
        nowIso(),
      );
    }
  }

  cancel(id: number): void {
    this.engine.cancel(String(id));
    this.pdb.db.run(
      "UPDATE migrations SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('running','pending','prechecking')",
      nowIso(),
      id,
    );
  }

  /** 迁移报告：任务概览 + 失败明细 + 检查点（含逐表分页方式）。 */
  report(id: number): {
    task: MigrationTaskDTO;
    precheck: MigrationPrecheckResult | null;
    errors: Array<{ table: string | null; rowKey: string | null; message: string; createdAt: string }>;
    checkpoints: Array<{
      table: string;
      lastOffset: number | null;
      pagination: CheckpointPagination | null;
      updatedAt: string | null;
    }>;
  } {
    const task = this.get(id);
    const precheckRow = this.pdb.db.get<{ precheck_result: string | null }>(
      'SELECT precheck_result FROM migrations WHERE id = ?',
      id,
    );
    let precheck: MigrationPrecheckResult | null = null;
    if (precheckRow?.precheck_result) {
      try {
        precheck = JSON.parse(precheckRow.precheck_result) as MigrationPrecheckResult;
      } catch {
        precheck = null;
      }
    }

    const errors = this.pdb.db
      .all<{ table_name: string | null; row_key: string | null; error_message: string | null; created_at: string }>(
        'SELECT table_name, row_key, error_message, created_at FROM migration_errors WHERE migration_id = ? ORDER BY id LIMIT 1000',
        id,
      )
      .map((r) => ({
        table: r.table_name,
        rowKey: r.row_key,
        message: r.error_message ?? '',
        createdAt: toIso(r.created_at) ?? '',
      }));

    const checkpoints = this.pdb.db
      .all<{ table_name: string; last_offset: number | null; last_key: string | null; updated_at: string | null }>(
        'SELECT table_name, last_offset, last_key, updated_at FROM migration_checkpoints WHERE migration_id = ? ORDER BY id',
        id,
      )
      .map((r) => ({
        table: r.table_name,
        lastOffset: r.last_offset === null ? null : Number(r.last_offset),
        pagination: parseCheckpointPagination(r.last_key),
        updatedAt: toIso(r.updated_at),
      }));

    return { task, precheck, errors, checkpoints };
  }
}

/** 解析检查点里保存的分页元信息；兼容旧数据（非 JSON 或字段缺失时返回 null）。 */
function parseCheckpointPagination(raw: string | null): CheckpointPagination | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckpointPagination>;
    if (typeof parsed.pagination !== 'string' || typeof parsed.status !== 'string') return null;
    return {
      pagination: parsed.pagination,
      orderBy: Array.isArray(parsed.orderBy) ? parsed.orderBy.map(String) : [],
      status: parsed.status,
      message: typeof parsed.message === 'string' ? parsed.message : null,
    };
  } catch {
    return null;
  }
}
