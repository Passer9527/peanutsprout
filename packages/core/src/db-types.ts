/**
 * 花生苗数据库管理工具 - 支持的数据库类型目录
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { PeanutError } from './errors.js';

/** 首批支持的数据库类型（PRD 4.1）。 */
export type DatabaseType =
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'oracle'
  | 'sqlserver'
  | 'sqlite'
  | 'kingbase'
  | 'dm'
  | 'oceanbase'
  | 'tidb'
  | 'redis'
  | 'mongodb'
  | 'clickhouse'
  | 'influxdb'
  | 'neo4j';

export type DatabaseCategory =
  | 'relational'
  | 'keyvalue'
  | 'document'
  | 'columnar'
  | 'timeseries'
  | 'graph';

export interface DbTypeInfo {
  code: DatabaseType;
  /** 界面展示名 */
  label: string;
  category: DatabaseCategory;
  /** 默认端口，文件型数据库为 null */
  defaultPort: number | null;
  /** 默认 schema（MySQL 为库名，PostgreSQL 为 public，SQLite 为 main） */
  defaultSchema: string;
  /** 连接串协议头，用于 URL 解析 */
  urlScheme: string;
  /** 该驱动在本期是否已真实实现（未实现的会在连接时抛 DRIVER_NOT_IMPLEMENTED） */
  driverImplemented: boolean;
  /** 是否需要主机端口 */
  networked: boolean;
}

/**
 * 首批支持的数据库类型目录（PRD 4.1）。
 *
 * driverImplemented 必须与 packages/drivers 的注册表保持一致：
 * 真实落地的是 SQLite、PostgreSQL、金仓 KingbaseES（复用 PG 线协议），
 * 以及 MySQL 协议族 MySQL/MariaDB/TiDB/OceanBase。
 * 早期这里除 sqlite 外全部写死 false，与 drivers registry（implemented=true）
 * 给出相反答案，界面会把已实现的驱动错误地标成"未实现"。
 * 这条契约由 packages/visualization/src/db-types.test.ts 的跨包一致性用例守护。
 */
export const DB_TYPES: readonly DbTypeInfo[] = [
  { code: 'mysql', label: 'MySQL', category: 'relational', defaultPort: 3306, defaultSchema: '', urlScheme: 'mysql', driverImplemented: true, networked: true },
  { code: 'mariadb', label: 'MariaDB', category: 'relational', defaultPort: 3306, defaultSchema: '', urlScheme: 'mariadb', driverImplemented: true, networked: true },
  { code: 'postgresql', label: 'PostgreSQL', category: 'relational', defaultPort: 5432, defaultSchema: 'public', urlScheme: 'postgresql', driverImplemented: true, networked: true },
  { code: 'oracle', label: 'Oracle', category: 'relational', defaultPort: 1521, defaultSchema: '', urlScheme: 'oracle', driverImplemented: false, networked: true },
  { code: 'sqlserver', label: 'SQL Server', category: 'relational', defaultPort: 1433, defaultSchema: 'dbo', urlScheme: 'sqlserver', driverImplemented: false, networked: true },
  { code: 'sqlite', label: 'SQLite', category: 'relational', defaultPort: null, defaultSchema: 'main', urlScheme: 'file', driverImplemented: true, networked: false },
  { code: 'kingbase', label: '金仓 KingbaseES', category: 'relational', defaultPort: 54321, defaultSchema: 'public', urlScheme: 'kingbase8', driverImplemented: true, networked: true },
  { code: 'dm', label: '达梦 DM', category: 'relational', defaultPort: 5236, defaultSchema: 'SYSDBA', urlScheme: 'dm', driverImplemented: false, networked: true },
  { code: 'oceanbase', label: 'OceanBase', category: 'relational', defaultPort: 2881, defaultSchema: '', urlScheme: 'oceanbase', driverImplemented: true, networked: true },
  { code: 'tidb', label: 'TiDB', category: 'relational', defaultPort: 4000, defaultSchema: '', urlScheme: 'tidb', driverImplemented: true, networked: true },
  { code: 'redis', label: 'Redis', category: 'keyvalue', defaultPort: 6379, defaultSchema: '0', urlScheme: 'redis', driverImplemented: false, networked: true },
  { code: 'mongodb', label: 'MongoDB', category: 'document', defaultPort: 27017, defaultSchema: 'admin', urlScheme: 'mongodb', driverImplemented: false, networked: true },
  { code: 'clickhouse', label: 'ClickHouse', category: 'columnar', defaultPort: 8123, defaultSchema: 'default', urlScheme: 'clickhouse', driverImplemented: false, networked: true },
  { code: 'influxdb', label: 'InfluxDB', category: 'timeseries', defaultPort: 8086, defaultSchema: '', urlScheme: 'influxdb', driverImplemented: false, networked: true },
  { code: 'neo4j', label: 'Neo4j', category: 'graph', defaultPort: 7687, defaultSchema: '', urlScheme: 'neo4j', driverImplemented: false, networked: true },
] as const;

const BY_CODE = new Map<string, DbTypeInfo>(DB_TYPES.map((t) => [t.code, t]));

export const ALL_DATABASE_TYPES: readonly DatabaseType[] = DB_TYPES.map((t) => t.code);

export function isDatabaseType(v: unknown): v is DatabaseType {
  return typeof v === 'string' && BY_CODE.has(v);
}

export function getDbTypeInfo(code: DatabaseType | string): DbTypeInfo {
  const info = BY_CODE.get(code);
  if (!info) {
    throw new PeanutError('VALIDATION_FAILED', `不支持的数据库类型: ${String(code)}`, {
      supported: [...BY_CODE.keys()],
    });
  }
  return info;
}
