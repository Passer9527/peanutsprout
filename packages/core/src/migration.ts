/**
 * 花生苗数据库管理工具 - 迁移与同步模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type MigrationMode = 'full' | 'incremental' | 'sync';
/**
 * 迁移任务状态。
 *
 * `skipped` 表示"任务本身成功结束，但部分表被**有意跳过**"：
 * 典型场景是无主键表在目标非空时的安全降级（跨方言逐行去重不可靠），
 * 或冲突策略为 skip/manual 时目标已有数据。它必须与 `success` 区分开，
 * 否则"目标表少了数据"会被当成迁移成功上报。
 */
export type MigrationStatus =
  | 'pending'
  | 'prechecking'
  | 'running'
  | 'success'
  | 'skipped'
  | 'failed'
  | 'cancelled';
export type ConflictStrategy = 'overwrite' | 'skip' | 'error' | 'manual';

export interface MigrationRequest {
  id?: string;
  name?: string;
  userId: number;
  sourceConnectionId: number;
  targetConnectionId: number;
  sourceSchema: string | null;
  targetSchema: string | null;
  /** 为空表示整库 */
  tables: string[];
  mode: MigrationMode;
  /** 是否迁移表结构（含索引/约束） */
  includeStructure: boolean;
  /** 是否迁移数据 */
  includeData: boolean;
  conflictStrategy?: ConflictStrategy;
  batchSize?: number;
  /** 失败重试次数 */
  retry?: number;
  dryRun?: boolean;
}

export interface SyncRequest extends MigrationRequest {
  /** 增量游标字段（如 updated_at） */
  cursorColumn?: string | null;
  since?: string | null;
}

export interface MigrationIssue {
  level: 'info' | 'warning' | 'error';
  table?: string;
  column?: string;
  message: string;
  suggestion?: string;
}

export interface MigrationPrecheckResult {
  ok: boolean;
  issues: MigrationIssue[];
  /** 源表 -> 目标表结构映射预览 */
  tableMappings: Array<{
    sourceTable: string;
    targetTable: string;
    columnMappings: Array<{
      sourceColumn: string;
      sourceType: string;
      targetColumn: string;
      targetType: string;
      lossy: boolean;
      note?: string;
    }>;
  }>;
  estimatedRows: number;
}

export interface MigrationResult {
  migrationId: string;
  status: MigrationStatus;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage?: string | null;
  errors: Array<{ table: string; rowKey: string | null; message: string }>;
}
