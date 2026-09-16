/**
 * 花生苗数据库管理工具 - 驱动 SPI（Service Provider Interface）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * PRD 第二部分的 Java 风格接口在这里等价改写为 TypeScript 接口，语义保持一致：
 *   DatabaseDriver / ConnectionConfig / MetadataProvider / QueryExecutor /
 *   DdlGenerator / TypeMapper / ExplainParser / MigrationProvider / AiProvider / AuditService
 */

import type { DatabaseType, DbTypeInfo } from './db-types.js';
import type {
  ColumnInfo,
  ConnectionConfig,
  ConnectionTestResult,
  ConstraintInfo,
  IndexInfo,
  SchemaInfo,
  TableInfo,
} from './connection.js';
import type { ExecutionPlan, QueryOptions, QueryResult } from './query.js';
import type { AuditEvent, AuditLogEntry, AuditQuery } from './auth.js';
import type { MigrationPrecheckResult, MigrationRequest, MigrationResult, SyncRequest } from './migration.js';
import type { AiRequestContext, DiagnosisResult, OptimizationResult, SqlGenerationResult } from './ai.js';

/** 一个已建立的数据库会话。由驱动实现负责生命周期与并发安全。 */
export interface DriverConnection {
  readonly id: string;
  readonly config: ConnectionConfig;
  /** 心跳 / 连通性 + 服务端版本 */
  ping(): Promise<{ latencyMs: number; serverVersion: string | null }>;
  getMetadata(): MetadataProvider;
  getQueryExecutor(): QueryExecutor;
  getDdlGenerator(): DdlGenerator;
  getTypeMapper(): TypeMapper;
  getExplainParser(): ExplainParser;
  close(): Promise<void>;
}

/**
 * 驱动主入口。每种数据库一个实现，通过 registry 按 dbType 解析。
 * 未实现的驱动应注册为 "占位驱动"：implemented=false，
 * connect() 抛 DRIVER_NOT_IMPLEMENTED，而不是静默失败。
 */
export interface DatabaseDriver {
  readonly dbType: DatabaseType;
  readonly name: string;
  readonly version: string;
  /** 本驱动是否已真实实现 */
  readonly implemented: boolean;
  /** 该驱动的能力声明，界面据此灰掉不支持的功能 */
  readonly capabilities: DriverCapabilities;
  getInfo(): DbTypeInfo;
  connect(config: ConnectionConfig): Promise<DriverConnection>;
  testConnection(config: ConnectionConfig): Promise<ConnectionTestResult>;
}

export interface DriverCapabilities {
  schemas: boolean;
  transactions: boolean;
  explain: boolean;
  /** 支持流式读取大结果集 */
  streaming: boolean;
  /** 支持服务端游标分页 */
  serverSidePagination: boolean;
  /** 支持 CDC / binlog 增量同步 */
  cdc: boolean;
  /** 支持 DDL 生成 */
  ddl: boolean;
}

export const DEFAULT_CAPABILITIES: DriverCapabilities = {
  schemas: true,
  transactions: true,
  explain: true,
  streaming: false,
  serverSidePagination: false,
  cdc: false,
  ddl: true,
};

export interface MetadataProvider {
  listSchemas(): Promise<SchemaInfo[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  listIndexes(schema: string, table: string): Promise<IndexInfo[]>;
  listConstraints(schema: string, table: string): Promise<ConstraintInfo[]>;
  listViews(schema: string): Promise<TableInfo[]>;
  listProcedures(schema: string): Promise<Array<{ name: string; kind: 'procedure' | 'function' }>>;
  listTriggers(schema: string): Promise<Array<{ name: string; table: string | null }>>;
}

export interface QueryExecutor {
  execute(sql: string, options?: QueryOptions): Promise<QueryResult>;
  executeUpdate(sql: string, params?: import('./query.js').CellValue[]): Promise<number>;
  explain(sql: string): Promise<ExecutionPlan>;
  cancel(queryId: string): void;
}

export interface DdlGenerator {
  /** 生成建表 DDL（表设计器预览用） */
  createTable(schema: string, table: string, columns: ColumnInfo[], indexes?: IndexInfo[]): string;
  dropTable(schema: string, table: string): string;
  addColumn(schema: string, table: string, column: ColumnInfo): string;
  alterColumn(schema: string, table: string, from: ColumnInfo, to: ColumnInfo): string;
  dropColumn(schema: string, table: string, column: string): string;
  createIndex(schema: string, table: string, index: IndexInfo): string;
  dropIndex(schema: string, table: string, indexName: string): string;
}

export interface TypeMapper {
  /** 源库类型 -> 目标库类型；无法精确映射时返回 { type, lossy: true, note } */
  mapType(sourceType: string, target: DatabaseType): { type: string; lossy: boolean; note?: string };
  /** 归一化类型，用于结构对比（把各库类型收敛到统一词汇） */
  normalizeType(rawType: string): string;
}

export interface ExplainParser {
  parse(raw: unknown): ExecutionPlan;
  /** 把执行计划转成可画图的树 */
  toTree(plan: ExecutionPlan): import('./query.js').ExecutionPlanNode[];
}

export interface MigrationProvider {
  precheck(request: MigrationRequest): Promise<MigrationPrecheckResult>;
  migrate(request: MigrationRequest, onProgress?: ProgressCallback): Promise<MigrationResult>;
  sync(request: SyncRequest, onProgress?: ProgressCallback): Promise<MigrationResult>;
  cancel(migrationId: string): void;
  resume(migrationId: string): Promise<MigrationResult>;
}

export interface ProgressCallback {
  (progress: {
    migrationId: string;
    phase: string;
    table?: string;
    processedRows: number;
    totalRows: number | null;
    message?: string;
  }): void;
}

/**
 * 结果集问答的返回值。
 *
 * `redactionApplied` 必须是**本次调用实际生效**的脱敏状态，由回答方一次性判定；
 * 调用方不得另行读设置去推断，否则会出现"声称已脱敏、实际发了明文"。
 */
export interface AiAnswerResult {
  text: string;
  redactionApplied: boolean;
  redactionNotes: string[];
}

export interface AiProvider {
  readonly name: string;
  generateSql(naturalLanguage: string, context: AiRequestContext): Promise<SqlGenerationResult>;
  explainSql(sql: string): Promise<string>;
  optimizeSql(sql: string, plan: ExecutionPlan | null): Promise<OptimizationResult>;
  generateDocumentation(context: AiRequestContext): Promise<string>;
  answerQuestion(question: string, context: AiRequestContext): Promise<AiAnswerResult>;
  diagnoseError(error: string, sql: string): Promise<DiagnosisResult>;
}

export interface AuditService {
  log(event: AuditEvent): number;
  query(query: AuditQuery): { items: AuditLogEntry[]; total: number };
  export(query: AuditQuery, format: 'csv' | 'json'): string;
  verifyChain(): { ok: boolean; checked: number; brokenAt: number | null };
  purge(before: string): number;
}
