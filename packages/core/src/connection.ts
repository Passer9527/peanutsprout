/**
 * 花生苗数据库管理工具 - 连接与元数据模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { DatabaseType } from './db-types.js';

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  /** 私钥路径或口令，明文形态只存在于内存 */
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
}

export interface SslConfig {
  enabled: boolean;
  mode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
}

/**
 * 领域层连接配置：password 是**已解密**的明文，仅在内存中短暂存在。
 * 持久化形态见 storage 包的 ConnectionRecord（password_enc 为 BLOB）。
 */
export interface ConnectionConfig {
  id: number;
  name: string;
  dbType: DatabaseType;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  password?: string | null;
  connectionUrl?: string | null;
  sshTunnel?: SshTunnelConfig | null;
  ssl?: SslConfig | null;
  extraParams?: Record<string, string> | null;
  readOnly: boolean;
  colorTag?: string | null;
}

/** 对外传输用的连接视图，**绝不包含口令**。 */
export interface ConnectionDTO {
  id: number;
  name: string;
  groupId: number | null;
  dbType: DatabaseType;
  host: string | null;
  port: number | null;
  databaseName: string | null;
  username: string | null;
  hasPassword: boolean;
  connectionUrl: string | null;
  colorTag: string | null;
  isReadOnly: boolean;
  isFavorite: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  serverVersion: string | null;
  message: string;
}

export interface SchemaInfo {
  name: string;
  comment?: string | null;
}

export type TableKind = 'table' | 'view' | 'materialized_view' | 'foreign_table';

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
  comment?: string | null;
  rowCount?: number | null;
}

export interface ColumnInfo {
  schema: string;
  table: string;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
  isPrimaryKey: boolean;
  ordinal: number;
}

export interface IndexInfo {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ConstraintInfo {
  schema: string;
  table: string;
  name: string;
  type: 'primary_key' | 'foreign_key' | 'unique' | 'check';
  definition: string;
}
