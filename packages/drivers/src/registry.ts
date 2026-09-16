/**
 * 花生苗数据库管理工具 - 驱动注册表与连接管理
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  PeanutError,
  getDbTypeInfo,
  isDatabaseType,
  type ConnectionConfig,
  type ConnectionTestResult,
  type DatabaseDriver,
  type DatabaseType,
  type DriverCapabilities,
  type DriverConnection,
} from '@peanutsprout/core';
import { MysqlDriver } from './mysql.js';
import { PostgresDriver } from './postgresql.js';
import { SqliteDriver } from './sqlite.js';
import { createPlaceholderDrivers } from './placeholder.js';

export interface DriverDescriptor {
  dbType: DatabaseType;
  label: string;
  category: string;
  defaultPort: number | null;
  networkRequired: boolean;
  driverImplemented: boolean;
  driverName: string;
  driverVersion: string;
  capabilities: DriverCapabilities;
}

export class DriverRegistry {
  private readonly drivers = new Map<DatabaseType, DatabaseDriver>();

  register(driver: DatabaseDriver): void {
    const existing = this.drivers.get(driver.dbType);
    // 已实现的驱动不能被后注册的占位驱动覆盖：注册顺序不应造成能力倒退
    if (existing?.implemented && !driver.implemented) return;
    this.drivers.set(driver.dbType, driver);
  }

  get(dbType: DatabaseType | string): DatabaseDriver | undefined {
    return isDatabaseType(dbType) ? this.drivers.get(dbType) : undefined;
  }

  /** 取驱动；数据库类型非法时抛 VALIDATION_FAILED。 */
  require(dbType: DatabaseType | string): DatabaseDriver {
    const info = getDbTypeInfo(dbType);
    const driver = this.drivers.get(info.code);
    if (!driver) {
      throw new PeanutError('DRIVER_NOT_IMPLEMENTED', `未注册的数据库类型: ${info.code}`);
    }
    return driver;
  }

  list(): DriverDescriptor[] {
    return [...this.drivers.values()]
      .map((d) => {
        const info = d.getInfo();
        return {
          dbType: d.dbType,
          label: info.label,
          category: info.category,
          defaultPort: info.defaultPort,
          networkRequired: info.networked,
          driverImplemented: d.implemented,
          driverName: d.name,
          driverVersion: d.version,
          capabilities: d.capabilities,
        };
      })
      .sort((a, b) => Number(b.driverImplemented) - Number(a.driverImplemented) || a.dbType.localeCompare(b.dbType));
  }

  implementedTypes(): DatabaseType[] {
    return [...this.drivers.values()].filter((d) => d.implemented).map((d) => d.dbType);
  }
}

/**
 * 连接管理器：按连接 id 缓存已建立的会话。
 * Web 端多用户并发下，每个用户的请求共享同一个池，但会话本身是线程内串行的
 * （node:sqlite 是同步 API，天然串行；远程驱动实现时需自行加锁）。
 */
export class ConnectionManager {
  private readonly live = new Map<
    number,
    { conn: DriverConnection; dbType: string; openedAt: number; lastUsedAt: number; readOnly: boolean }
  >();

  /**
   * 正在建立中的连接。
   *
   * 旧实现是「查 map → await connect → 再 set」，中间的 await 会造成竞态：
   * 两个并发首连各建一条连接，后者覆盖前者，前者永远不被关闭（PG/MySQL
   * 就是整整一个连接池泄漏）。这里缓存进行中的 Promise，让并发调用等待同一个。
   */
  private readonly pending = new Map<number, Promise<DriverConnection>>();

  constructor(private readonly registry: DriverRegistry) {}

  async acquire(config: ConnectionConfig): Promise<DriverConnection> {
    const existing = this.live.get(config.id);
    if (existing) {
      // 只读标记变了就丢弃旧会话，避免"取消只读后仍写不进去"
      if (existing.readOnly === config.readOnly && existing.dbType === config.dbType) {
        existing.lastUsedAt = Date.now();
        return existing.conn;
      }
      await this.release(config.id);
    }

    const inflight = this.pending.get(config.id);
    if (inflight) return inflight;

    const task = (async () => {
      const driver = this.registry.require(config.dbType);
      const conn = await driver.connect(config);
      this.live.set(config.id, {
        conn,
        dbType: config.dbType,
        openedAt: Date.now(),
        lastUsedAt: Date.now(),
        readOnly: config.readOnly,
      });
      return conn;
    })();
    this.pending.set(config.id, task);
    try {
      return await task;
    } finally {
      // 只清理自己登记的那条，避免把后来者的 Promise 误删
      if (this.pending.get(config.id) === task) this.pending.delete(config.id);
    }
  }

  get(connectionId: number): DriverConnection | undefined {
    return this.live.get(connectionId)?.conn;
  }

  /** 借出连接并在用完后自动归还（失败也会归还，避免泄漏半开连接）。 */
  async withConnection<T>(config: ConnectionConfig, fn: (conn: DriverConnection) => Promise<T>): Promise<T> {
    const conn = await this.acquire(config);
    try {
      return await fn(conn);
    } finally {
      const entry = this.live.get(config.id);
      if (entry) entry.lastUsedAt = Date.now();
    }
  }

  async release(connectionId: number): Promise<void> {
    const entry = this.live.get(connectionId);
    if (!entry) return;
    this.live.delete(connectionId);
    await entry.conn.close().catch(() => undefined);
  }

  async releaseAll(): Promise<void> {
    const ids = [...this.live.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
  }

  stats(): Array<{ connectionId: number; dbType: string; openedAt: string; lastUsedAt: string; idleMs: number }> {
    const now = Date.now();
    return [...this.live.entries()].map(([id, e]) => ({
      connectionId: id,
      dbType: e.dbType,
      openedAt: new Date(e.openedAt).toISOString(),
      lastUsedAt: new Date(e.lastUsedAt).toISOString(),
      idleMs: now - e.lastUsedAt,
    }));
  }

  /** 释放空闲超过 idleMs 的会话（长连接守护）。 */
  async releaseIdle(idleMs: number): Promise<number> {
    const now = Date.now();
    const stale = [...this.live.entries()].filter(([, e]) => now - e.lastUsedAt > idleMs).map(([id]) => id);
    await Promise.all(stale.map((id) => this.release(id)));
    return stale.length;
  }

  async test(config: ConnectionConfig): Promise<ConnectionTestResult> {
    const driver = this.registry.require(config.dbType);
    return driver.testConnection(config);
  }

  get size(): number {
    return this.live.size;
  }
}

/** 组装默认注册表：内置 SQLite 驱动 + 其余类型的占位驱动。 */
export function createDefaultRegistry(): DriverRegistry {
  const registry = new DriverRegistry();
  registry.register(new SqliteDriver());

  // PostgreSQL 协议族：金仓 KingbaseES 兼容 PG 线协议，复用同一实现
  registry.register(new PostgresDriver('postgresql', 'PostgreSQL'));
  registry.register(new PostgresDriver('kingbase', '金仓 KingbaseES'));

  // MySQL 协议族：MariaDB / TiDB / OceanBase 均为 MySQL 兼容协议
  registry.register(new MysqlDriver('mysql', 'MySQL'));
  registry.register(new MysqlDriver('mariadb', 'MariaDB'));
  registry.register(new MysqlDriver('tidb', 'TiDB'));
  registry.register(new MysqlDriver('oceanbase', 'OceanBase'));

  for (const placeholder of createPlaceholderDrivers()) registry.register(placeholder);
  return registry;
}
