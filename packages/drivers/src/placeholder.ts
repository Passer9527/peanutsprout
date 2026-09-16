/**
 * 花生苗数据库管理工具 - 未实现驱动的占位实现
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计要点：驱动未实现时必须**显式失败**而不是静默返回空结果。
 * 这样界面能给出"该驱动尚未实现，欢迎贡献"的明确提示，
 * 也保证 PRD 4.1 里的数据库清单始终可枚举、可展示。
 */

import {
  PeanutError,
  getDbTypeInfo,
  type ConnectionConfig,
  type ConnectionTestResult,
  type DatabaseDriver,
  type DatabaseType,
  type DbTypeInfo,
  type DriverCapabilities,
  type DriverConnection,
} from '@peanutsprout/core';

export class NotImplementedDriver implements DatabaseDriver {
  readonly implemented = false;
  readonly version = '0.0.0';
  /** 未实现的驱动不声明任何能力，界面据此置灰相关功能。 */
  readonly capabilities: DriverCapabilities = {
    schemas: false,
    transactions: false,
    explain: false,
    streaming: false,
    serverSidePagination: false,
    cdc: false,
    ddl: false,
  };

  constructor(
    readonly dbType: DatabaseType,
    readonly name: string,
    private readonly hint?: string,
  ) {}

  getInfo(): DbTypeInfo {
    return getDbTypeInfo(this.dbType);
  }

  async connect(config: ConnectionConfig): Promise<DriverConnection> {
    throw new PeanutError(
      'DRIVER_NOT_IMPLEMENTED',
      `${this.name} 驱动尚未实现，暂时无法连接 "${config.name}"`,
      {
        dbType: this.dbType,
        hint:
          this.hint ??
          '该数据库类型已在产品规划中，驱动适配器待实现；可先使用 SQLite/MariaDB 等已支持的数据库',
      },
    );
  }

  async testConnection(config: ConnectionConfig): Promise<ConnectionTestResult> {
    return {
      ok: false,
      latencyMs: 0,
      serverVersion: null,
      message: `${this.name} 驱动尚未实现（连接 "${config.name}" 未真正发起）`,
    };
  }
}

/**
 * 尚未实现的驱动。已实现的（SQLite / PostgreSQL / 金仓 / MySQL / MariaDB /
 * TiDB / OceanBase）不再出现在这里 —— 注册表会优先使用真实实现。
 */
export function createPlaceholderDrivers(): NotImplementedDriver[] {
  return [
    new NotImplementedDriver('oracle', 'Oracle'),
    new NotImplementedDriver('sqlserver', 'SQL Server'),
    new NotImplementedDriver('dm', '达梦 DM'),
    new NotImplementedDriver('oceanbase', 'OceanBase'),
    new NotImplementedDriver('tidb', 'TiDB'),
    new NotImplementedDriver('redis', 'Redis'),
    new NotImplementedDriver('mongodb', 'MongoDB'),
    new NotImplementedDriver('clickhouse', 'ClickHouse'),
    new NotImplementedDriver('influxdb', 'InfluxDB'),
    new NotImplementedDriver('neo4j', 'Neo4j'),
  ];
}
